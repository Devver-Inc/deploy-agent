import { AsyncMutex } from "../../utils/async-mutex";

// ponytail: global lock favors correctness; use per-repo locks if deploy throughput becomes measurable.
export const lifecycleLock = new AsyncMutex();
