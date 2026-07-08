import { spawn } from "node:child_process";

// run a command with spawn and collect the output
export function getCommandOutput(command: string, args: string[], input?: string ): Promise<string> {
    return new Promise((resolve, reject) => {
        let stdout: string = ""
        let stderr: string = ""

        const child = spawn(command, args, {shell: false, stdio: ["pipe", "pipe", "pipe"]});

        child.stdout.on("data", (data) => stdout += data.toString());
        child.stderr.on("data", (data) => stderr += data.toString());

        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolve(stdout.trim()); else reject(new Error(stderr.trim() || `command failed with exit code ${code}`));
        });

        if (input) child.stdin.write(input);
        child.stdin.end();
    });
}