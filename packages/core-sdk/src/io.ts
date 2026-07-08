export interface IOInterface {
    readonly stdin: NodeJS.ReadStream;
    readonly stdout: NodeJS.WriteStream;
    readonly stderr: NodeJS.WriteStream;
}
