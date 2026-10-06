#!/bin/zsh
# Act 1 + Act 2 end to end against the running stack, approving every step like a user would.
set -e
A=localhost:4000
H=(-H 'x-overpaid-client: script' -H "x-operator-token: ${OPERATOR_TOKEN:-}")
curl -s "${H[@]}" -XPOST $A/api/demo/reset >/dev/null
curl -s "${H[@]}" -XPOST $A/api/find/run -H 'content-type: application/json' -d '{"mode":"demo"}' >/dev/null
curl -s "${H[@]}" -XPOST $A/api/fix -H 'content-type: application/json' -d '{"opportunityIds":"all"}' >/dev/null
for i in {1..40}; do
  for id in $(curl -s "$A/api/approvals?state=pending" | python3 -c "import json,sys;print(' '.join(a['id'] for a in json.load(sys.stdin)))"); do
    curl -s "${H[@]}" -XPOST $A/api/approvals/$id -H 'content-type: application/json' -d '{"approved":true}' -o /dev/null
  done
  left=$(curl -s $A/api/tasks | python3 -c "import json,sys;print(sum(1 for t in json.load(sys.stdin)['tasks'] if t['state'] in ('queued','running','needs_approval')))")
  [ "$left" = "0" ] && break
  sleep 3
done
curl -s $A/api/tasks | python3 -c "
import json,sys;d=json.load(sys.stdin);print('recovered cents',d['recoveredCents'])
for t in d['tasks']: print(t['state'].ljust(16),t['merchant'].ljust(15),str(t['recoveredCents']).ljust(6),(t['step'] or '')[:40],(t['evidenceSha256'] or '')[:12])"
