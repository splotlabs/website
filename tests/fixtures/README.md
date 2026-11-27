# Test fixtures for the benchmarks page

These files are synthetic test data, not measurements. The benchmarks harness generated them:

- Repository: [splotlabs/benchmarks](https://github.com/splotlabs/benchmarks)
- Commit: `206eb6294206218a639137f1422eadf72647c39b`
- Command: `python3 tests/make_viewer_fixtures.py OUT_DIR`

The tests read `empty/index.json`, `main/index.json` and `main/datasets/<dataset_id>/summary.json`.
They do not read the bundles, the CSV, the lock, the manifest or the checksums, so these files
are not copied. The tests check download links as URLs only.

Do not edit or reformat these files. To change them, run the generator again at a newer harness
commit, copy the same files, and update the commit above. States that the harness cannot produce
(official or local data, an upstream release asset, unsupported versions, invalid data) are
in-memory changes inside `tests/benchmarks.spec.ts`.
