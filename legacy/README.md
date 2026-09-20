# Archived physical prototype

`physical_prototype/` preserves the original console/Flask/JSON Serial prototype
for protocol reference. It is not an active backend. Both IPC and IPCSIM now start
`ipc_core.api:app`. The old entry point automatically opened rack 1 at startup;
the shared runtime never sends an unsolicited hardware command.
