/**
 * Pure-function utilities for the sync state machine.
 */

import type { SyncAction, SyncPlan, SyncStatus, SyncPhase } from '@/types';

const PHASE_ORDER: SyncPhase[] = [
  'idle',
  'planning',
  'pulling',
  'uploading',
  'conflict',
  'finalizing',
  'done',
  'error',
  'cancelled',
];

export function nextPhase(current: SyncPhase, action: { type: string }): SyncPhase {
  switch (action.type) {
    case 'start':
      return 'planning';
    case 'pulling':
      return 'pulling';
    case 'uploading':
      return 'uploading';
    case 'conflict-detected':
      return 'conflict';
    case 'conflict-resolved':
      return 'uploading';
    case 'finalize':
      return 'finalizing';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'cancel':
      return 'cancelled';
    default:
      return current;
  }
}

export function initialStatus(): SyncStatus {
  return {
    phase: 'idle',
    startedAt: null,
    updatedAt: 0,
    total: 0,
    done: 0,
    message: '',
    conflicts: 0,
    errors: 0,
  };
}

export function statusForPlan(plan: SyncPlan, phase: SyncPhase): SyncStatus {
  return {
    phase,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    total: plan.actions.length,
    done: 0,
    message: '',
    conflicts: 0,
    errors: 0,
  };
}

export function nextActionIndex(actions: SyncAction[], cursor: number): number {
  for (let i = cursor; i < actions.length; i++) {
    if (actions[i].kind !== 'noop') return i;
  }
  return actions.length;
}

export function isTerminal(phase: SyncPhase): boolean {
  return phase === 'done' || phase === 'error' || phase === 'cancelled';
}

export function phaseLabel(phase: SyncPhase): string {
  switch (phase) {
    case 'idle':
      return '空闲';
    case 'planning':
      return '正在对比基线…';
    case 'pulling':
      return '正在拉取远端变更…';
    case 'uploading':
      return '正在上传本地变更…';
    case 'conflict':
      return '等待处理冲突…';
    case 'finalizing':
      return '正在提交基线…';
    case 'done':
      return '同步完成';
    case 'error':
      return '同步出错';
    case 'cancelled':
      return '已取消';
  }
}

export function phaseOrderIndex(phase: SyncPhase): number {
  return PHASE_ORDER.indexOf(phase);
}
