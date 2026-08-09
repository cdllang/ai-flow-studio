export const workspaceViews = ['editor', 'library', 'runner', 'models', 'skills', 'runs', 'versions'] as const;

export type WorkspaceView = (typeof workspaceViews)[number];

const workflowWorkspaceViews: readonly WorkspaceView[] = ['editor', 'models', 'skills', 'runs', 'versions'];

export function canUseWorkflowAssistant(view: WorkspaceView) {
  return view === 'editor';
}

export function canShowWorkflowWorkspaceNavigation(view: WorkspaceView) {
  return workflowWorkspaceViews.includes(view);
}
