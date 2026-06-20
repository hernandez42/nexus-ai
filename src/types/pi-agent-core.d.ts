// Type stub for optional '@earendil-works/pi-agent-core' dependency
// When pi-agent-core is not installed, these types prevent TS errors

declare module "@earendil-works/pi-agent-core" {
  export interface AgentOptions {
    initialState?: Record<string, any>;
  }
  export interface AgentEvent {
    type: string;
    message?: { content?: string };
  }
  export class Agent {
    constructor(options?: AgentOptions);
    subscribe(listener: (event: AgentEvent, signal?: AbortSignal) => void): () => void;
    prompt(message: string | any[]): Promise<void>;
    waitForIdle(): Promise<void>;
    get state(): any;
  }
}
