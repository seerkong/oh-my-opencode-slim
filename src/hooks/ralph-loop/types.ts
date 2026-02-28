import type { RalphLoopConfig } from '../../config';

export type RalphLoopStatus = 'running' | 'suspended';

export interface RalphLoopState {
  active: boolean;
  iteration: number;
  max_iterations: number;
  completion_promise: string;
  yield_promise?: string;
  started_at: string;
  prompt: string;
  session_id?: string;
  ultrawork?: boolean;
  status?: RalphLoopStatus;
  suspended_at?: string;
  resume_mode?: string;
  resume_file?: string;
  last_resume_payload?: string;
  next_poll_at?: string;
}

export interface RalphLoopOptions {
  config?: RalphLoopConfig;
  apiTimeout?: number;
  checkSessionExists?: (sessionId: string) => Promise<boolean>;
  /** 获取会话 transcript JSONL 文件路径，用于快速完成检测 */
  getTranscriptPath?: (sessionId: string) => string;
}
