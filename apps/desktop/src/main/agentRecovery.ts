export interface RecoveryMessageLike {
  role: "user" | "assistant";
  modelId: string;
  agentTurnId?: string;
}

export interface RecoveryProjectionDecision {
  committed: boolean;
  notice: string;
}

const NOT_COMMITTED_NOTICE = "上次 AI 任务因应用关闭而中断，未完成内容没有自动写入，也不会自动重试工具。请确认后重新发送上一条问题。";
const COMMITTED_NOTICE = "上次 AI 回复已经保存，但应用在写入运行完成状态前关闭。请先检查现有回复，无需重复发送；系统不会自动重试工具。";

export function decideInterruptedTurnProjection(messages: RecoveryMessageLike[], turnId: string): RecoveryProjectionDecision {
  const committed = messages.some((message) => {
    if (message.role !== "assistant" || message.modelId === "runtime-recovery") return false;
    return message.agentTurnId === turnId;
  });
  return {
    committed,
    notice: committed ? COMMITTED_NOTICE : NOT_COMMITTED_NOTICE
  };
}
