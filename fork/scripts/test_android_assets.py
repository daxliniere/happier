import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('android_assets', Path(__file__).with_name('verify-android-assets.py'))
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class AndroidStartupAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        values = self.root / 'app/src/main/res/values'
        values.mkdir(parents=True)
        self.set_runtime('file:fingerprint')
        (self.root / 'app/src/main/AndroidManifest.xml').write_text(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application>'
            '<meta-data android:name="expo.modules.updates.ENABLED" android:value="true"/>'
            '</application></manifest>', encoding='utf-8')

    def set_runtime(self, runtime):
        (self.root / 'app/src/main/res/values/strings.xml').write_text(
            f'<resources><string name="expo_runtime_version">{runtime}</string></resources>', encoding='utf-8')

    def archive(self, extension, fingerprint=None, manifest=True, bundle=True):
        target = self.root / ('release.' + extension)
        prefix = 'base/assets/' if extension == 'aab' else 'assets/'
        with ZipFile(target, 'w') as package:
            if bundle:
                package.writestr(prefix + 'index.android.bundle', 'bundled JavaScript')
            if manifest:
                package.writestr(prefix + 'app.manifest', json.dumps({'assets': []}))
            if fingerprint is not None:
                package.writestr(prefix + 'fingerprint', fingerprint)
        return target

    def test_missing_fingerprint_rejects_both_release_formats(self):
        for extension in ('apk', 'aab'):
            with self.subTest(extension=extension):
                with self.assertRaisesRegex(ValueError, 'missing required startup asset .*fingerprint'):
                    assets.verify(self.archive(extension), self.root)

    def test_complete_archives_pass(self):
        for extension in ('apk', 'aab'):
            with self.subTest(extension=extension):
                assets.verify(self.archive(extension, fingerprint='a-native-runtime-hash'), self.root)

    def test_empty_fingerprint_rejected(self):
        with self.assertRaisesRegex(ValueError, 'empty startup asset .*fingerprint'):
            assets.verify(self.archive('apk', fingerprint='\n'), self.root)

    def test_explicit_runtime_needs_no_fingerprint(self):
        self.set_runtime('0.2.11-native')
        assets.verify(self.archive('apk'), self.root)

    def test_missing_manifest_or_bundle_rejected(self):
        for missing in ('manifest', 'bundle'):
            with self.subTest(missing=missing):
                with self.assertRaisesRegex(ValueError, 'missing required startup asset'):
                    assets.verify(self.archive('apk', fingerprint='hash', **{missing: False}), self.root)


if __name__ == '__main__':
    unittest.main()
