# Train a 3D Gaussian splat on Modal from a COLMAP-posed image set, matching the
# recipe recorded in whymelabs.gaussian-training-run.v1 manifests (nerfstudio
# splatfacto on CUDA 11.8). The playroom example was trained exactly this way;
# this script makes the recipe reproducible for any scene.
#
# Usage:
#   modal volume put <volume> <local-data-dir> /data/<scene>
#   modal run scripts/train-splatfacto-modal.py --scene workshop \
#     --images images-jpeg-2k --iterations 15000 --every-nth 3
#
# The volume layout expected under /data/<scene>:
#   colmap/sparse/0/{cameras.bin,images.bin,points3D.bin}   full-res model
#   <images>/...                                            posed frames
#
# Outputs under /runs/<run-name>/export/:
#   <scene>.splatfacto.ply and run-manifest.json

import json
import shutil
import struct
import time
from pathlib import Path

import modal

app = modal.App("whymelabs-splatfacto")

volume = modal.Volume.from_name("spatial-gaussian-examples")

training_image = (
    modal.Image.from_registry("nvidia/cuda:11.8.0-devel-ubuntu22.04", add_python="3.10")
    .apt_install("git", "libgl1", "libglib2.0-0", "colmap")
    .pip_install(
        "torch==2.1.2+cu118",
        "torchvision==0.16.2+cu118",
        extra_index_url="https://download.pytorch.org/whl/cu118",
    )
    .pip_install("nerfstudio==1.1.5")
    .run_commands(
        # gsplat compiles its CUDA kernels on first import; bake that into the
        # image instead of paying it on every run.
        "python -c 'import gsplat' || true",
    )
)


def _read_cameras_bin(path: Path):
    cameras = {}
    with open(path, "rb") as stream:
        count = struct.unpack("<Q", stream.read(8))[0]
        for _ in range(count):
            camera_id, model_id, width, height = struct.unpack("<iiQQ", stream.read(24))
            parameter_counts = {
                0: 3, 1: 4, 2: 4, 3: 5, 4: 8, 5: 8, 6: 12, 7: 5, 8: 4, 9: 5, 10: 12,
            }
            values = struct.unpack(
                f"<{parameter_counts[model_id]}d",
                stream.read(8 * parameter_counts[model_id]),
            )
            cameras[camera_id] = {
                "model_id": model_id,
                "width": width,
                "height": height,
                "params": list(values),
            }
    return cameras


def _write_cameras_bin(path: Path, cameras):
    with open(path, "wb") as stream:
        stream.write(struct.pack("<Q", len(cameras)))
        for camera_id, camera in cameras.items():
            stream.write(struct.pack(
                "<iiQQ",
                camera_id,
                camera["model_id"],
                camera["width"],
                camera["height"],
            ))
            stream.write(struct.pack(f"<{len(camera['params'])}d", *camera["params"]))


def _rescale_cameras(source: Path, destination: Path, target_width: int, target_height: int):
    """Scale intrinsics from the full-resolution model to the resized frames.

    Focal lengths and principal points scale per-axis; distortion coefficients
    are dimensionless and carry over unchanged.
    """
    cameras = _read_cameras_bin(source)
    for camera in cameras.values():
        scale_x = target_width / camera["width"]
        scale_y = target_height / camera["height"]
        model_id = camera["model_id"]
        params = camera["params"]
        if model_id == 0:  # SIMPLE_PINHOLE f, cx, cy
            params[0] *= scale_x
            params[1] *= scale_x
            params[2] *= scale_y
        elif model_id in (1, 4):  # PINHOLE / OPENCV fx, fy, cx, cy, ...
            params[0] *= scale_x
            params[1] *= scale_y
            params[2] *= scale_x
            params[3] *= scale_y
        elif model_id in (2, 3):  # SIMPLE_RADIAL / RADIAL f, cx, cy, k...
            params[0] *= scale_x
            params[1] *= scale_x
            params[2] *= scale_y
        else:
            raise ValueError(f"unsupported COLMAP camera model id {model_id}")
        camera["width"] = target_width
        camera["height"] = target_height
    _write_cameras_bin(destination, cameras)


@app.function(
    image=training_image,
    gpu="A10G",
    timeout=4 * 60 * 60,
    volumes={"/vol": volume},
)
def train(
    scene: str,
    images: str,
    iterations: int,
    every_nth: int,
    target_width: int,
    target_height: int,
):
    from PIL import Image as PillowImage

    started = time.time()
    data_root = Path("/vol/data") / scene
    run_name = f"{scene}-{images.replace('/', '_')}-n{every_nth}-{iterations}"
    run_root = Path("/vol/runs") / run_name
    workspace = Path("/tmp/workspace")
    workspace.mkdir(parents=True, exist_ok=True)

    # Stage a frame subset with flattened names so the COLMAP image records can
    # be filtered to exactly the staged files.
    # COLMAP image records use flat basenames while the resized tree nests one
    # directory per camera; basenames are unique and shared between the two.
    source_images = sorted((data_root / images).rglob("*.jpg"))
    staged = workspace / "images"
    staged.mkdir(exist_ok=True)
    kept_names = set()
    for index, source in enumerate(source_images):
        if index % every_nth:
            continue
        shutil.copy2(source, staged / source.name)
        kept_names.add(source.name)
    if not kept_names:
        raise RuntimeError(f"no frames staged from {data_root / images}")

    probe = PillowImage.open(next(staged.iterdir()))
    if (probe.width, probe.height) != (target_width, target_height):
        raise RuntimeError(
            f"staged frames are {probe.width}x{probe.height}, "
            f"expected {target_width}x{target_height}",
        )

    # Rescale the full-resolution model to the staged frame size, and rewrite
    # image records to the flattened names, dropping frames outside the subset.
    sparse_source = data_root / "colmap/sparse/0"
    sparse = workspace / "colmap/sparse/0"
    sparse.mkdir(parents=True, exist_ok=True)
    _rescale_cameras(
        sparse_source / "cameras.bin",
        sparse / "cameras.bin",
        target_width,
        target_height,
    )
    shutil.copy2(sparse_source / "points3D.bin", sparse / "points3D.bin")
    _filter_images_bin(
        sparse_source / "images.bin",
        sparse / "images.bin",
        kept_names,
    )

    import subprocess

    run_directory = workspace / "runs"
    subprocess.run(
        [
            "ns-train", "splatfacto",
            "--data", str(workspace),
            "--output-dir", str(run_directory),
            "--experiment-name", run_name,
            "--max-num-iterations", str(iterations),
            "--viewer.quit-on-train-completion", "True",
            "colmap",
            "--colmap-path", "colmap/sparse/0",
            "--images-path", "images",
            "--auto-scale-poses", "False",
            "--center-method", "none",
            "--orientation-method", "none",
        ],
        check=True,
    )

    config = next(run_directory.glob(f"{run_name}/splatfacto/*/config.yml"))
    export_directory = run_root / "export"
    export_directory.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ns-export", "gaussian-splat",
            "--load-config", str(config),
            "--output-dir", str(export_directory),
        ],
        check=True,
    )
    exported = next(export_directory.glob("*.ply"))
    final = export_directory / f"{scene}.splatfacto.ply"
    exported.rename(final)

    import hashlib

    digest = hashlib.sha256(final.read_bytes()).hexdigest()
    manifest = {
        "schemaVersion": "whymelabs.gaussian-training-run.v1",
        "run": run_name,
        "dataset": f"Meta EyefulTower {scene} {images}",
        "datasetLicense": "MIT",
        "registeredImageCount": len(kept_names),
        "method": "nerfstudio splatfacto",
        "nerfstudioVersion": "1.1.5",
        "iterations": iterations,
        "gpuRequest": "A10G",
        "containerCuda": "11.8.0",
        "elapsedSecondsThisInvocation": round(time.time() - started, 3),
        "export": {
            "path": str(final),
            "bytes": final.stat().st_size,
            "sha256": digest,
        },
    }
    (run_root / "run-manifest.json").write_text(json.dumps(manifest, indent=2))
    volume.commit()
    return manifest


def _filter_images_bin(source: Path, destination: Path, kept_names):
    with open(source, "rb") as stream:
        count = struct.unpack("<Q", stream.read(8))[0]
        records = []
        for _ in range(count):
            header = stream.read(64)
            image_id = struct.unpack("<I", header[:4])[0]
            name_bytes = b""
            while True:
                char = stream.read(1)
                if char == b"\x00":
                    break
                name_bytes += char
            points_count = struct.unpack("<Q", stream.read(8))[0]
            points = stream.read(24 * points_count)
            records.append((image_id, header, name_bytes.decode(), points_count, points))
    with open(destination, "wb") as stream:
        kept = [r for r in records if r[2] in kept_names]
        if not kept:
            raise RuntimeError("no COLMAP image records match the staged frames")
        stream.write(struct.pack("<Q", len(kept)))
        for image_id, header, name, points_count, points in kept:
            stream.write(header)
            stream.write(name.encode() + b"\x00")
            stream.write(struct.pack("<Q", points_count))
            stream.write(points)


@app.local_entrypoint()
def main(
    scene: str = "workshop",
    images: str = "images-jpeg-2k",
    iterations: int = 15000,
    every_nth: int = 3,
    target_width: int = 1368,
    target_height: int = 2048,
):
    manifest = train.remote(
        scene,
        images,
        iterations,
        every_nth,
        target_width,
        target_height,
    )
    print(json.dumps(manifest, indent=2))
