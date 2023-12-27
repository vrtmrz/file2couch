/**
 * Upload File to CouchDB as attachment
 *
 */

console.log(" -- File To CouchDB Uploader --");

import { parseArgs } from "https://deno.land/std@0.210.0/cli/parse_args.ts";
import { expandGlob } from "https://deno.land/std@0.210.0/fs/expand_glob.ts";
import { relative } from "https://deno.land/std@0.210.0/path/relative.ts";
import * as posix from "https://deno.land/std@0.210.0/path/posix/mod.ts";
import * as win32 from "https://deno.land/std@0.210.0/path/windows/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.210.0/encoding/base64.ts";
import { typeByExtension } from "https://deno.land/std@0.210.0/media_types/type_by_extension.ts";
import { extname } from "https://deno.land/std@0.210.0/path/extname.ts";

const parsedArgs = parseArgs(Deno.args);
const fileFrom = `${parsedArgs?._[0] ?? ""}`;
const pattern = "filter" in parsedArgs ? `${parsedArgs.filter}` : "**";
const uploadTo = `${parsedArgs?._[1] ?? ""}`;
const uploadDocName = `${parsedArgs?._[2] ?? ""}`;

let basicUser = Deno.env.get("F2C_USER");
let basicPwd = Deno.env.get("F2C_PASSWORD");
if ("user" in parsedArgs) basicUser = parsedArgs.user;
if ("password" in parsedArgs) basicPwd = parsedArgs.password;

console.log(`File From : ${fileFrom}`);
console.log(`Filter    : ${pattern}`);
console.log(`Upload To : ${uploadDocName} on ${uploadTo}`);

const defaultHeaders = {} as Record<string, any>;

if (basicUser && basicPwd) {
    console.log(`Auth      : User:${basicUser}, Pwd:${basicPwd?.length} letters`);
    defaultHeaders.Authorization = `Basic ${encodeBase64(`${basicUser}:${basicPwd}`)}`;
} else {
    console.log(`Auth      : No credentials`);
}
// console.dir(parsedArgs);

console.log("-----");
const targetFiles = [] as {
    name: string;
    localPath: string;
    mimetype: string;
}[];

function typeByExtensionEx(ext: string) {
    if (ext == ".ts") {
        return "text/typescript";
    }
    return typeByExtension(ext);
}
for await (const entry of expandGlob(`${fileFrom}/${pattern}`)) {
    if (entry.isDirectory) continue;
    const f = relative(fileFrom, entry.path);
    const fUp = f.split(win32.SEP).join(posix.SEP);
    console.log(`Target    : ${fUp}`);

    targetFiles.push({
        name: fUp,
        localPath: entry.path,
        mimetype: typeByExtensionEx(extname(f)) ?? `application/octet-stream`,
    });
}

const BASE_URI = uploadTo;

function blob2base64(blob: Blob): Promise<string | undefined> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const out = e?.target?.result as string | undefined;
            if (!out) return undefined;
            resolve(out.split(";base64,")[1]);
        };
        reader.readAsDataURL(blob);
    });
}

const sendData = { _id: uploadDocName, _attachments: {} as Record<string, any> } as Record<string, any>;
try {
    const old = await (
        await fetch(`${BASE_URI}${sendData._id}?attachments=true`, {
            headers: {
                ...defaultHeaders,
                accept: "application/json",
            },
        })
    ).json();
    // console.dir(old);
    if (old && old._rev) {
        sendData._attachments = old._attachments;
        sendData._rev = old._rev;
    }
} catch (ex) {
    console.dir(ex);
}
let updatedCount = 0;
for (const tf of targetFiles) {
    try {
        const f = tf.name;
        const file = await Deno.readFile(tf.localPath);
        const encoded = new Blob([file]);
        const stringData = await blob2base64(encoded);
        if (stringData === undefined) continue;
        if (f in sendData._attachments && sendData._attachments[f].data == stringData) {
            console.log(`Not changed  :${f}`);
            delete sendData._attachments[f].data;
            sendData._attachments[f].stub = true;
        } else {
            console.log(`Upload queued:${f}`);
            sendData._attachments[f] = {
                content_type: tf.mimetype,
                data: stringData,
            };
            updatedCount++;
        }
        // console.dir(hash);
        // console.log(`${f}->${hash2}`);
    } catch (ex) {
        console.dir(ex);
    }
}
const keys = [...Object.keys(sendData._attachments)];
for (const f of keys) {
    const last = targetFiles.find((e) => e.name === f);
    // console.log(`Last:${f}, ?${last}`);
    if (!last) {
        delete sendData._attachments[f];
    }
}
// console.dir(sendData);

if (updatedCount != 0) {
    const sendReq = fetch(`${BASE_URI}${sendData._id}`, {
        headers: {
            ...defaultHeaders,
        },
        body: JSON.stringify(sendData),
        method: "PUT",
    });
    const ret = await (await sendReq).json();
    console.dir(ret);
} else {
    console.log("Everything up-to-date");
}
