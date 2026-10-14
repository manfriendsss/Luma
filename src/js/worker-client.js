// Gọi Web Worker xử lý ảnh; tự rơi về luồng chính nếu trình duyệt không hỗ trợ (không có OffscreenCanvas + WebGL 2 trong worker).
import { state } from "./core.js";

let worker = null;
let nextId = 1;
const pending = new Map();

function spawn() {
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module", name: "luma-worker" });
  } catch {
    worker = null;
    return null;
  }
  worker.onmessage = (event) => {
    const { id, ok, result, error, name, progress } = event.data || {};
    const job = pending.get(id);
    if (!job) return;
    if (progress !== undefined) { job.onProgress?.(progress); return; }
    pending.delete(id);
    if (ok) job.resolve(result);
    else {
      const err = name === "AbortError" ? new DOMException(error, "AbortError") : new Error(error);
      job.reject(err);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    for (const job of pending.values()) job.reject(new Error("worker"));
    pending.clear();
    state.capabilities.worker = false;
  };
  return worker;
}

/** Gửi một tác vụ cho worker. Trả về { promise, cancel }. */
export function runTask(type, payload, { onProgress, transfer = [] } = {}) {
  if (!worker && !spawn()) return { promise: Promise.reject(new Error("worker")), cancel() {} };
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, type, payload }, transfer);
  });
  return { id, promise, cancel: () => worker?.postMessage({ type: "cancel", payload: { jobId: id } }) };
}

/** Kiểm tra khả năng của worker một lần lúc khởi động. */
export async function probeWorker() {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return { webgl: false, avif: false };
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000));
    return await Promise.race([runTask("probe", {}).promise, timeout]);
  } catch {
    return { webgl: false, avif: false };
  }
}

export const workerReady = () => !!state.capabilities.worker;
