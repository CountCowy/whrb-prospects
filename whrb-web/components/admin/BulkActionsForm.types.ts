// Stage 10c: shared types between BulkActionsForm and BulkPreviewTable.

export type Filter = {
  q?: string;
  tier?: string;
  state?: string;
  assigned_to?: string;
  zip?: string;
  category?: string;
  source?: string;
  is_nonprofit?: 'true' | 'false';
  assigned?: 'true' | 'false';
};

export type MatchedRow = {
  id: string;
  company_name: string;
  tier: string | null;
  state: string;
  assigned_to: string | null;
};

export type Assignee = { id: string; label: string; deactivated: boolean };

export type Action = 'assign' | 'state' | 'tier' | 'delete';

export type SelectionMode = 'filter' | 'basket';
