// Type stub for optional 'eve' dependency
// When eve is not installed, these types prevent TS errors

declare module "eve" {
  export interface AgentDefinition {
    description?: string;
    model?: any;
  }
  export function defineAgent(def: AgentDefinition): any;
}
