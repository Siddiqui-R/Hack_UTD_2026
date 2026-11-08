export interface RecordSnapshot {
  schemaVersion: number; generatedAt: string;
  incident: { id: string; title: string; severity: string; status: string; type: string; containment: string; systemsAffected: string; detectedAt: string; createdAt: string; updatedAt: string; reportedBy: string };
  permissions: { canReadEvidence: boolean; canReadScope: boolean };
  verification: { ok: boolean; checked: string; brokenAt?: string; reason: string; anchorOk?: boolean; anchorStatus: string; anchorReason: string };
  auditHead: { seq: string; hash: string };
  anchoredCheckpoint: null | { seq: string; headHash: string; at: string; externalRef: string; independentlyVerified: boolean };
  audit: { seq: string; action: string; actor: string; createdAt: string; payloadJson: string; prevHash: string; eventHash: string }[];
  // Progress fields are additive; older snapshots omit them (treat as open and unassigned).
  tasks: { id: string; text: string; assigneeRole: string; createdBy: string; createdAt?: string; status?: string; assignee?: string | null;
    version?: string; completedBy?: string | null; completedAt?: string | null; note?: string }[];
  evidence: { id: string; text: string; submittedBy: string; createdAt: string }[];
  conflicts: { id: string; evidenceIdA: string; evidenceIdB: string; reason: string }[];
  investigations: { id: string; modelId: string; mode: string; status: string; summary: string; previousSummary: string; latencyMs: string }[];
  closures: {id:string;status:string;reason:string;requestedBy:string;requestedAt:string;expiresAt:string;approvals:{approver:string;at:string}[]}[];
  scope: { id: string; asset: string; dataType: string; state: string; confidence: string; records: string }[];
}
export const formatMicros = (value: string) => new Date(Number(BigInt(value)/1000n)).toISOString().replace('T',' ').replace('.000Z','Z');
