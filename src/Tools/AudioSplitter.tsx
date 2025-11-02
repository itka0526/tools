import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";

import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { TypographyH2 } from "@/components/ui/typography";

export default function AudioSplitter() {
    const { current: ffmpeg } = useRef(new FFmpeg());
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [segmentCount, setSegmentCount] = useState(3);
    const [progress, setProgress] = useState<{
        percentage: string;
        time: string;
    } | null>(null);

    const writeToLogs = (log: string) => setLogs((prev) => [...prev, log]);

    useEffect(() => {
        ffmpeg.on("progress", ({ progress, time }) => {
            setProgress({ percentage: `${(progress * 100).toFixed(2)}%`, time: `${(time / 1000000).toFixed(0)}s` });
        });
        if (import.meta.env.DEV) {
            ffmpeg.on("log", ({ message, type }) => {
                setLogs((prev) => [...prev.slice(-400), ` ${type.toUpperCase()}: ${message},`]);
            });
        }
        (async () => {
            setLoading(true);
            try {
                await ffmpeg.load({ coreURL, wasmURL });
                setLogs((prev) => [...prev, "Loaded ffmpeg successfully"]);
                if (import.meta.env.DEV) {
                    await ffmpeg.exec(["-loglevel", "debug"]);
                }
                setReady(true);
            } catch (err) {
                if (err instanceof Error) {
                    writeToLogs(err.message);
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [ffmpeg]);

    function handleFile(event: ChangeEvent<HTMLInputElement>) {
        const { files } = event.target;
        if (files !== null && files.length > 0) {
            writeToLogs(`Selected file "${files[0].name}"`);
            setFile(files[0]);
        } else {
            setFile(null);
        }
    }

    async function handleSplit() {
        if (!file) {
            return writeToLogs("File is not ready.");
        }

        if (!ready) {
            return writeToLogs("ffmpeg is not loaded.");
        }

        setLoading(true);
        setLogs([]);

        if (!(await ffmpeg.writeFile(file.name, await fetchFile(file)))) {
            setLoading(false);
            return writeToLogs("Cannot write file");
        }

        writeToLogs("Wrote file to ffmpeg's file system");

        const probeErr = await ffmpeg.ffprobe([
            "-i",
            file.name,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            "-o",
            `${file.name}-duration`, // Save to file
        ]);

        if (probeErr === 1) {
            setLoading(false);
            return writeToLogs("Error occurred when retrieving duration");
        }

        const rawDuration = await ffmpeg.readFile(`${file.name}-duration`); // Gonna assume its gonna always run

        const durationStr = typeof rawDuration === "string" ? rawDuration : new TextDecoder("utf-8").decode(rawDuration as Uint8Array);
        const totalSeconds = parseFloat(durationStr.trim());

        if (!isFinite(totalSeconds) || totalSeconds <= 0) {
            setLoading(false);
            return writeToLogs(`Invalid duration "${durationStr}"`);
        }

        writeToLogs(`Duration ${totalSeconds.toFixed(3)}s`);

        const segLen = totalSeconds / segmentCount;

        for (let i = 0; i < segmentCount; i++) {
            const start = (i * segLen).toFixed(3);
            const isLast = i === segmentCount - 1;

            const outName = `${String(i + 1).padStart(3, "0")}_${file.name}`;

            const args = ["-ss", start, "-i", file.name];

            // const args = ["-i", file.name, "-f", "segment", "-segment_time", "10"];

            if (!isLast) args.push("-t", segLen.toFixed(3));

            args.push(outName);

            writeToLogs(`Cut ${i + 1}/${segmentCount}: start=${start}s${!isLast ? ` len=${segLen.toFixed(3)}s` : " (to end)"}`);

            if ((await ffmpeg.exec(args)) === 1) {
                writeToLogs(`Failed to run command ffmpeg ${args.join(" ")}`);
            }

            const data = await ffmpeg.readFile(outName);

            if (typeof data === "string") {
                writeToLogs(`Unexpected string output for "${outName}" -> "${data}"`);
                continue;
            }

            const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.length) as ArrayBuffer], { type: file.type });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = outName;
            document.body.appendChild(a);
            a.click();
            a.remove();
        }

        setLoading(false);
        setProgress(null);
    }

    return (
        <div className="flex flex-col gap-6 justify-center py-4 min-w-2/5">
            <TypographyH2>Audio Splitter 0.0.1</TypographyH2>

            <Textarea
                spellCheck={"false"}
                defaultValue={logs.join("\n") + (progress ? `\nProgess: ${progress.percentage}; Time: ${progress?.time}\n` : "")}
                readOnly
                className="h-40 text-nowrap leading-tight"
            ></Textarea>

            <Input
                value={`${segmentCount}`}
                onChange={(event) => {
                    const { value } = event.target;
                    if (Number(value) <= 0) {
                        return writeToLogs("Cannot set below or equal to 0");
                    }
                    return setSegmentCount(Number(event.target.value));
                }}
                type="number"
            ></Input>

            <div className="flex gap-6 justify-end">
                <Button variant={"secondary"}>
                    <label htmlFor="audio-splitter-file" className="w-full h-full">
                        Select
                    </label>
                </Button>
                <Input id="audio-splitter-file" type="file" className="hidden" onChange={handleFile} multiple={false} />
                <Button disabled={loading} onClick={handleSplit}>
                    Run
                </Button>
            </div>
        </div>
    );
}
