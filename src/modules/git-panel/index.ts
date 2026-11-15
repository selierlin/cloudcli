export { default as GitPanel } from '@/modules/git-panel/GitPanel';
// The workspace header badges the project with the same change count the git
// panel lists, so the two surfaces cannot disagree about how many files differ.
export { getChangedFileCount } from '@/modules/git-panel/utils/gitPanelUtils';
