import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createRouteTestBuilder } from "../../testkit/routeTestBuilder";
import { versionRoutes } from "./versionRoutes";
import packageJson from "../../../../../package.json";
import forkBuild from "../../../../../../../fork/build-version.json";

describe("versionRoutes GET /v1/version", () => {
    it("embeds the current fork build number", () => {
        expect(forkBuild.version).toBe(readFileSync(new URL('../../../../../../../fork/VERSION', import.meta.url), 'utf8').trim());
    });
    it("responds with ok=true for server validation probes", async () => {
        const route = createRouteTestBuilder({
            method: "GET",
            path: "/v1/version",
            registerRoutes(app) {
                versionRoutes(app as any);
            },
        });
        const { response } = await route.invoke();
        expect(response).toEqual({ ok: true, version: packageJson.version, fork_version: forkBuild.version });
    });

    it("reports an exact deployed source revision when the release environment provides one", async () => {
        const prior = process.env.HAPPIER_RELEASE_SOURCE_SHA;
        process.env.HAPPIER_RELEASE_SOURCE_SHA = "a".repeat(40);
        try {
            const route = createRouteTestBuilder({
                method: "GET",
                path: "/v1/version",
                registerRoutes(app) {
                    versionRoutes(app as any);
                },
            });
            const { response } = await route.invoke();
            expect(response).toEqual({ ok: true, version: packageJson.version, fork_version: forkBuild.version, source_sha: "a".repeat(40) });
        } finally {
            if (prior === undefined) delete process.env.HAPPIER_RELEASE_SOURCE_SHA;
            else process.env.HAPPIER_RELEASE_SOURCE_SHA = prior;
        }
    });
});
