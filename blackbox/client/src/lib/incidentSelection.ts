import type { Incident } from '../module_bindings/types';

export type IncidentInput = Pick<Incident, 'title' | 'incidentType' | 'severity' | 'detectedAt' | 'systemsAffected' | 'containmentStatus'>;
export type PendingIncident = { input: IncidentInput; existingIds: ReadonlySet<bigint> };

// IDs are not sequential. Match a new subscribed row to the submitted fields, never the largest ID.
// Ambiguous matches stay unselected; a deliberate selection cancels the pending request in Command.
export function createdIncident(rows: readonly Incident[], pending: PendingIncident, reporter: Incident['reportedBy']) {
  const { input, existingIds } = pending;
  const matches = rows.filter(row => !existingIds.has(row.id) && row.reportedBy.isEqual(reporter)
    && row.title === input.title.normalize('NFC').trim() && row.incidentType === input.incidentType && row.severity === input.severity
    && row.detectedAt.microsSinceUnixEpoch === input.detectedAt.microsSinceUnixEpoch
    && row.systemsAffected === input.systemsAffected.normalize('NFC').trim() && row.containmentStatus === input.containmentStatus);
  return matches.length === 1 ? matches[0] : undefined;
}
