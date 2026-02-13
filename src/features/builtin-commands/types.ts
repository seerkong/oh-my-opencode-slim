export type BuiltinCommandName =
  | 'ralph-loop'
  | 'cancel-ralph'
  | 'ralph-resume'
  | 'ulw-loop';

export interface BuiltinCommandDefinition {
  name: BuiltinCommandName;
  description: string;
  template: string;
  argumentHint?: string;
}
