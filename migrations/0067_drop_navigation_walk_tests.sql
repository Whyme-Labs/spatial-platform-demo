-- The in-scene walk test no longer gates publication and no longer has a
-- recording control: its only assertion was that the end pose differed from
-- the start pose, while the processor already proves enclosure, wall sweeps,
-- corner slides, route replay, and reachability, and the operator approves the
-- build with a typed review note. With the gate and the UI gone the Worker
-- neither writes nor reads this table.
DROP TABLE IF EXISTS scene_navigation_walk_tests;
