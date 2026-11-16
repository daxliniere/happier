import { describe, expect, it } from 'vitest';

import { buildClaudeStartOptionsFromParsedArgs } from './command';
import { partitionProviderSessionArgs } from '@/cli/providerSessionArgPartition';

describe('buildClaudeStartOptionsFromParsedArgs', () => {
  it('threads --agent-mode plan into StartOptions so a plan-created session spawns Claude in plan mode (incident cmq9hemcs)', () => {
    const parsed = partitionProviderSessionArgs({
      args: [
        '--happy-starting-mode', 'remote',
        '--started-by', 'daemon',
        '--permission-mode', 'safe-yolo',
        '--permission-mode-updated-at', '1781181377912',
        '--agent-mode', 'plan',
        '--agent-mode-updated-at', '1781181377912',
        '--model', 'claude-haiku-4-5',
        '--model-updated-at', '1781181377912',
      ],
      providerSubcommand: 'claude',
      forwardModelFlag: true,
      forwardResumeFlag: true,
      yoloProviderArgs: ['--dangerously-skip-permissions'],
    });

    const options = buildClaudeStartOptionsFromParsedArgs(parsed, undefined);

    expect(options.agentModeId).toBe('plan');
    expect(options.agentModeUpdatedAt).toBe(1781181377912);
    expect(options.permissionMode).toBe('safe-yolo');
    expect(options.permissionModeUpdatedAt).toBe(1781181377912);
    expect(options.modelId).toBe('claude-haiku-4-5');
    expect(options.startedBy).toBe('daemon');
  });

  it('keeps a daemon session-control --model out of claudeArgs so a later in-app model switch is not pinned', () => {
    const parsed = partitionProviderSessionArgs({
      args: [
        '--happy-starting-mode', 'remote',
        '--started-by', 'daemon',
        '--model', 'claude-fable-5',
        '--model-updated-at', '1781181377912',
        '--verbose',
      ],
      providerSubcommand: 'claude',
      forwardModelFlag: true,
      forwardResumeFlag: true,
      yoloProviderArgs: ['--dangerously-skip-permissions'],
    });

    const options = buildClaudeStartOptionsFromParsedArgs(parsed, undefined);

    // The session-control model still seeds the session's initial model...
    expect(options.modelId).toBe('claude-fable-5');
    expect(options.modelUpdatedAt).toBe(1781181377912);
    // ...but must not become a raw Claude arg, which would override every later mode.model.
    expect(options.claudeArgs).toEqual(['--verbose']);
  });

  it('still forwards a user-typed --model (no --model-updated-at) as a raw Claude arg', () => {
    const parsed = partitionProviderSessionArgs({
      args: ['--model', 'opus', 'fix this'],
      providerSubcommand: 'claude',
      forwardModelFlag: true,
      forwardResumeFlag: true,
      yoloProviderArgs: ['--dangerously-skip-permissions'],
    });

    const options = buildClaudeStartOptionsFromParsedArgs(parsed, undefined);

    expect(options.modelId).toBe('opus');
    expect(options.claudeArgs).toEqual(['--model', 'opus', 'fix this']);
  });

  it('omits agent-mode fields when --agent-mode is not provided', () => {
    const parsed = partitionProviderSessionArgs({
      args: ['--permission-mode', 'yolo'],
      providerSubcommand: 'claude',
      forwardModelFlag: true,
      forwardResumeFlag: true,
      yoloProviderArgs: ['--dangerously-skip-permissions'],
    });

    const options = buildClaudeStartOptionsFromParsedArgs(parsed, undefined);

    expect('agentModeId' in options).toBe(false);
    expect('agentModeUpdatedAt' in options).toBe(false);
  });
});
