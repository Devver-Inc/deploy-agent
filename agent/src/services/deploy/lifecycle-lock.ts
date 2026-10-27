import { KeyedAsyncMutex } from "../../utils/async-mutex";

export const lifecycleLock = new KeyedAsyncMutex();
