# LingBot-Map local-run assessment

Research date: 2026-07-28

Upstream revision inspected:
[`1f480aeb8a47a24656090d46d053115b7fe60435`](https://github.com/Robbyant/lingbot-map/tree/1f480aeb8a47a24656090d46d053115b7fe60435)

## Verdict

**Not usefully as-is on this Mac.** The interactive `demo.py` has a CPU/SDPA
fallback that may be sufficient for a very small smoke test, but the upstream
code does not select Apple's MPS backend. On this 16 GB Apple M2 machine it
would therefore load and infer in CPU float32. That path is not documented as a
supported configuration, was not installed or executed in this assessment, and
is likely to be slow and memory-constrained.

The offline MP4 renderer cannot run from the unmodified repository on this Mac.
It requires NVIDIA Kaolin plus two extensions compiled from `.cu` sources, and
their bindings explicitly require CUDA tensors.

For a representative local deployment, use an NVIDIA CUDA machine (the
upstream recommendation is PyTorch 2.8.0 with CUDA 12.8). The Viser UI can
still be viewed in a normal browser.

## Machine and repository facts

| Item | Observed |
|---|---|
| Host | macOS 26.2, Apple M2 (10 GPU cores), arm64 |
| Memory | 16 GB unified memory |
| Conda | 23.5.2, available |
| System Python | 3.14.4; upstream asks for Python 3.10 |
| Current LingBot environment | None; PyTorch and all declared Python dependencies are absent from the active environment |
| Shallow upstream checkout | 451 MB, including three example scenes |
| Checkpoint | One of `lingbot-map-long.pt` or `lingbot-map.pt`, each 4.63 GB |

The 4.63 GB file size is published by the
[official Hugging Face model repository](https://huggingface.co/robbyant/lingbot-map/tree/main).
The repository ships 286 courthouse, 237 loop, and 324 university images at
the inspected commit.

## Why the stock Mac path is limited

1. The README installs the CUDA 12.8 build of PyTorch and recommends
   FlashInfer, which JIT-compiles CUDA kernels. It documents `--use_sdpa` as the
   non-FlashInfer fallback. Source:
   [upstream installation and fallback instructions](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/README.md#installation).
2. `demo.py` chooses only `cuda` or `cpu`:
   `torch.device("cuda" if torch.cuda.is_available() else "cpu")`. It contains
   no `mps` device path; on this Mac it therefore chooses CPU and float32.
   Source:
   [pinned `demo.py`](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/demo.py).
3. The model package does not declare PyTorch itself. Torch and torchvision
   must be installed separately before `pip install -e .`. Source:
   [pinned `pyproject.toml`](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/pyproject.toml).
4. PyTorch itself supports macOS, but that does not make this application use
   the Apple GPU; application code must select an MPS device.
   Source: [official PyTorch macOS installation guide](https://pytorch.org/get-started/locally/#mac-installation).
5. The batch renderer imports CUDA extensions built from `CUDAExtension`, and
   its C++ bindings reject non-CUDA tensors. Source:
   [pinned extension build](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/demo_render/render_cuda_ext/setup.py).
   NVIDIA's own Kaolin documentation says full functionality requires an
   NVIDIA CUDA GPU and macOS is CPU-only:
   [Kaolin installation requirements](https://kaolin.readthedocs.io/en/latest/notes/installation.html).

## Prerequisites

### Interactive demo on the supported CUDA path

- Git.
- Conda and Python 3.10.
- NVIDIA GPU, compatible driver, and CUDA 12.8 for the upstream-recommended
  stack.
- PyTorch 2.8.0 and torchvision 0.23.0 CUDA 12.8 wheels.
- Base package dependencies from `pyproject.toml`: Pillow,
  `huggingface_hub`, Einops, Safetensors, OpenCV, tqdm, and SciPy.
- `.[vis]` extras: Viser, Trimesh, Matplotlib, ONNX Runtime, and Requests.
- FlashInfer for the recommended paged-cache backend, or `--use_sdpa` to avoid
  it.
- One public 4.63 GB model checkpoint from
  <https://huggingface.co/robbyant/lingbot-map/tree/main>.

### Additional offline-renderer prerequisites

- `open3d`, PyYAML, `onnxruntime-gpu`, NVIDIA Kaolin, ffmpeg, a local CUDA
  toolkit with `nvcc`, and an in-place build of `voxel_morton_ext` and
  `frustum_cull_ext`.
- Note: the inspected `pyproject.toml` defines `vis` and `demo` extras but no
  `render` extra, although the README says to install `.[vis,render]`.
  `demo_render/requirements.txt` is therefore the more concrete dependency
  list at this revision:
  [pinned requirements](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/demo_render/requirements.txt).

There is no Dockerfile or Compose file in the inspected repository.

## Environment variables and external services

No API key or required environment variable is declared for the basic
interactive demo.

- Model weights must be downloaded from the public Hugging Face or ModelScope
  repository; the demo requires a local `--model_path` and does not fetch the
  checkpoint itself.
- `--mask_sky` triggers a first-use download of `skyseg.onnx` from Hugging
  Face and caches masks beside the input folder. Omit `--mask_sky` for an
  offline smoke test.
- Viser starts a local HTTP/WebSocket server on port `8080` by default. The
  implementation binds `0.0.0.0`, so it is not restricted to loopback:
  [pinned viewer source](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/lingbot_map/vis/point_cloud_viewer.py).
- `demo.py` sets `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` unless
  `--compile` is supplied. `LINGBOT_DEBUG_KV` is an optional debug switch, not
  a prerequisite.
- The `.pt` checkpoint is loaded with `torch.load(..., weights_only=False)`.
  Use only the first-party checkpoint and verify its provenance before running
  it:
  [pinned model-loading code](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/demo.py#L131-L163).

## Upstream CUDA startup

```bash
git clone https://github.com/Robbyant/lingbot-map.git
cd lingbot-map

conda create -n lingbot-map python=3.10 -y
conda activate lingbot-map

pip install torch==2.8.0 torchvision==0.23.0 \
  --index-url https://download.pytorch.org/whl/cu128
pip install -e ".[vis]"
pip install --index-url https://pypi.org/simple flashinfer-python

python demo.py \
  --model_path /absolute/path/to/lingbot-map-long.pt \
  --image_folder example/courthouse
```

Then open <http://localhost:8080>.

## Best-effort Apple M2 CPU smoke test

This is a feasibility experiment, not an upstream-supported recipe. Use the
normal macOS PyTorch wheels, force SDPA, limit the input aggressively, and do
not enable `--compile` or the CUDA renderer:

```bash
git clone https://github.com/Robbyant/lingbot-map.git
cd lingbot-map

conda create -n lingbot-map-mac python=3.10 -y
conda activate lingbot-map-mac

pip install torch==2.8.0 torchvision==0.23.0
pip install -e ".[vis]"

python demo.py \
  --model_path /absolute/path/to/lingbot-map-long.pt \
  --image_folder example/courthouse \
  --use_sdpa \
  --first_k 8 \
  --num_scale_frames 2 \
  --camera_num_iterations 1
```

Expected boundary: this should select `cpu`, not the M2 GPU. Success would only
prove that the small CPU path reaches the Viser viewer; it would not validate
the advertised ~20 FPS CUDA performance, long-sequence reconstruction, or the
offline rendering pipeline.

## Recommended next check

If local execution is still valuable, run the eight-frame CPU command in a
fresh Conda environment while monitoring peak memory and elapsed time. Stop
after that smoke test if it swaps heavily or fails before inference. For
practical use, provision an NVIDIA CUDA host and run the upstream command
unchanged.
