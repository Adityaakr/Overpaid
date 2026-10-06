#!/bin/zsh
# Rebuild every Ombud dashboard image: panels first, then composites (compose + text swaps). Order matters:
# the composite text swaps read the composed output.
set -e
cd "$(dirname $0)"
Y=YO44CxSuDbYmHpLfFH35MLPzds.png; S=0XNd3EZozYPqRrxZfevjonai8U0.png; L=MOOn5KFiBbiRmvvVAWZCtFU7yc.png; R=dQY9FBvFlctDbiSvrmlqaKEE5o.png
node ocrpatch.js specs-cards.json
node ocrpatch.js specs-dash.json
node compose.js ecsvVHaKUpgixFh7HmsoZYYI.png $Y $S $L $R
SCALE=0.5574 node compose.js NuWg5aIArrlBZcGfM8DjwwGPzTU.png $Y $S $L $R
SCALE=0.5574 CLIP=243,111,1212,977 node compose.js pVhCvoaWzVe0jBDDk8jH4KFVnE.png $Y $S
SCALE=0.434 CLIP=190,88,948,763 node compose.js rW7spDR9MBaWCOSwrBC32sdFf4Y.jpg YXAw0SFKPBH82TMVsfRwjHkfM.png@458,259 FZAXfvfeAtXMjRtAfvycp4f5c.png@671,259 EhSjphdOXhWTXmMtWBHR8tWrA.png@884,259 $S
node ocrpatch.js specs-comp.json
