declare module 'lucide-react';

declare module 'dockerode' {
  export interface ContainerInfo {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Status: string;
  }

  export interface ContainerInspectInfo {
    Id: string;
    Name: string;
    State?: {
      Running?: boolean;
      Status?: string;
    };
    Config: {
      Image?: string;
      Env?: string[] | null;
      Cmd?: string[] | null;
      WorkingDir?: string;
      ExposedPorts?: Record<string, Record<string, never>> | null;
    };
    HostConfig: {
      Memory?: number;
      NanoCpus?: number;
      PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | null;
    };
  }

  export interface DockerodeOptions {
    socketPath?: string;
    host?: string;
    port?: number;
    protocol?: 'http' | 'https' | 'ssh';
  }

  export interface Container {
    inspect(): Promise<ContainerInspectInfo>;
  }

  export default class Dockerode {
    constructor(options?: DockerodeOptions);
    ping(): Promise<Buffer | string>;
    listContainers(options?: { all?: boolean }): Promise<ContainerInfo[]>;
    getContainer(id: string): Container;
  }
}
