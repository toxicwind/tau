import { expect, test, describe } from "bun:test";
import { globPaths } from "../src/glob";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("globPaths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glob-test-"));

    test("should find files matching a simple pattern", async () => {
        const file = path.join(tempDir, "test.txt");
        fs.writeFileSync(file, "hello");
        
        const results = await globPaths("*.txt", { cwd: tempDir });
        expect(results).toContain("test.txt");
        
        fs.unlinkSync(file);
    });

    test("should respect exclude patterns", async () => {
        const file1 = path.join(tempDir, "a.txt");
        const file2 = path.join(tempDir, "b.txt");
        fs.writeFileSync(file1, "a");
        fs.writeFileSync(file2, "b");
        
        const results = await globPaths("*.txt", { cwd: tempDir, exclude: ["b.txt"] });
        expect(results).toContain("a.txt");
        expect(results).not.toContain("b.txt");
        
        fs.unlinkSync(file1);
        fs.unlinkSync(file2);
    });
});
