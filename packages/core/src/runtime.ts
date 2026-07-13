import { spawn } from "node:child_process";
import type { RuntimeObservation } from "@context-ray/schema";

export interface ObserveRuntimeOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  forwardOutput?: boolean;
}

export async function observeRuntime(
  command: string[],
  options: ObserveRuntimeOptions,
): Promise<RuntimeObservation> {
  const executable = command[0];
  if (!executable) throw new Error("A runtime command is required.");
  const startedAt = new Date().toISOString();
  const started = performance.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, command.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
    });
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (options.forwardOutput !== false) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (options.forwardOutput !== false) process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      resolve({
        command,
        startedAt,
        durationMs: Math.round(performance.now() - started),
        exitCode,
        signal,
        stdoutBytes,
        stderrBytes,
        note: "Context Ray observed process metadata only; it did not infer hidden provider prompts from stdout or stderr.",
      });
    });
  });
}
