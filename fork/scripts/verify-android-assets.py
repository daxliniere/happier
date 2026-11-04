#!/usr/bin/env python3
"""Reject Android release archives whose embedded Expo startup assets are missing."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def verify(archive: Path, android_project: Path) -> None:
    strings = ET.parse(android_project / 'app/src/main/res/values/strings.xml')
    runtime_version = strings.findtext(".//string[@name='expo_runtime_version']")
    manifest = ET.parse(android_project / 'app/src/main/AndroidManifest.xml')
    android = '{http://schemas.android.com/apk/res/android}'
    updates = manifest.find(".//meta-data[@" + android + "name='expo.modules.updates.ENABLED']")
    updates_enabled = updates is not None and updates.get(android + 'value') == 'true'
    prefix = 'base/assets/' if archive.suffix == '.aab' else 'assets/'
    with ZipFile(archive) as package:
        def asset(name: str) -> bytes:
            target = prefix + name
            if target not in package.namelist():
                raise ValueError(f'{archive.name}: missing required startup asset {target}')
            content = package.read(target)
            if not content.strip():
                raise ValueError(f'{archive.name}: empty startup asset {target}')
            return content

        asset('index.android.bundle')
        if updates_enabled:
            json.loads(asset('app.manifest'))
            if runtime_version == 'file:fingerprint':
                asset('fingerprint').decode('utf-8')
    print(f'Android startup assets verified: {archive}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--android-project', type=Path, required=True)
    parser.add_argument('archives', type=Path, nargs='+')
    args = parser.parse_args()
    for archive_path in args.archives:
        verify(archive_path, args.android_project)
