// Display labels only. Every stored/submitted value (enum strings, reducer arguments, tool names)
// stays exactly as the module defines it; these maps only change what a person reads.
const VALUES: Record<string, string> = {
  triage: 'Needs review', investigating: 'Under investigation', contained: 'Contained', eradicated: 'Threat removed', closed: 'Closed',
  none: 'Not contained', partial: 'Partly contained',
  unknown: 'Not yet known', compromised: 'Compromised', encrypted: 'Encrypted', exfiltrated: 'Data taken', unaffected: 'No impact recorded',
  unconfirmed: 'Not yet confirmed', likely: 'Likely', confirmed: 'Confirmed',
  commander: 'Commander', responder: 'Responder', observer: 'Observer',
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};
export const displayValue = (value: string) => VALUES[value] ?? value;
export const containmentLabel = (value: string) => ({ none: 'Not contained', partial: 'Partly contained', contained: 'Contained' } as Record<string, string>)[value] ?? value;
export const statusLabel = (value: string) => VALUES[value] ?? value;

// Agent tool names stay visible in technical details; this is the plain-language line.
const TOOLS: Record<string, string> = {
  searchIncidents: 'Find the incident', search_incidents: 'Find the incident',
  getScope: 'Review affected data', get_scope: 'Review affected data',
  evidenceRecords: 'Read the evidence', evidence_records: 'Read the evidence',
  createTask: 'Create a response task', create_task: 'Create a response task',
  updateSeverity: 'Review the severity', update_severity: 'Review the severity',
  flagConflict: 'Compare conflicting reports', flag_conflict: 'Compare conflicting reports',
};
export const toolLabel = (name: string) => TOOLS[name] ?? name;

const EVENTS: Record<string, string> = {
  'incident.create': 'Incident opened', 'incident.update': 'Incident updated',
  'evidence.submit': 'Evidence added', 'agent.conflict': 'Reports marked as conflicting', 'agent.task': 'Response task created',
  'agent.severity': 'Severity changed by the agent', 'agent.enroll': 'Agent authorised', 'agent.run.request': 'Investigation requested',
  'scope.add': 'System or data recorded', 'scope.update': 'System or data updated',
  'closure.request': 'Close request sent', 'closure.approve': 'Close request approved', 'closure.cancel': 'Close request cancelled', 'incident.close': 'Incident closed',
  'invite.create': 'Invite code created', 'invite.redeem': 'Teammate joined', 'invite.bootstrap': 'Commander invite created',
  'session.revoke': 'Access removed', 'message.send': 'Chat message sent',
};
// Unknown actions (including a tampered value) are shown verbatim, never prettified away.
export const eventLabel = (name: string) => EVENTS[name] ?? name;

export const incidentNumber = (id: bigint) => `INC-${id.toString().padStart(3, '0')}`;
