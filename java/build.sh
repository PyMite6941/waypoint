#!/bin/sh
# Builds waypoint-presenter.jar. Needs a JDK 17 or newer; nothing else.
set -e
cd "$(dirname "$0")"
rm -rf out && mkdir -p out
javac --release 17 -d out src/waypoint/*.java
jar --create --file waypoint-presenter.jar --main-class waypoint.Main -C out .
echo "Built java/waypoint-presenter.jar. Run: java -jar java/waypoint-presenter.jar [deck.waypoint.json]"
