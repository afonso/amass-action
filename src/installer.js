import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';

const ROOT_URL = "https://github.com/owasp-amass/amass/releases/download";

function getPackage() {
    const arch = os.arch();
    let osName;

    switch (os.type()) {
        case 'Windows_NT':
            osName = 'Windows';
            break;
        case 'Darwin':
            osName = 'Darwin';
            break;
        case 'FreeBSD':
            osName = 'Freebsd';
            break;
        case 'Linux':
            osName = 'Linux';
            break;
        default:
            throw new Error(`Unsupported OS type: ${os.type()}`);
    }

    const archMap = {
        x64: 'amd64',
        arm64: 'arm64',
        arm: 'arm',
        ia32: '386'
    };

    const goArch = archMap[arch];
    if (!goArch) {
        throw new Error(`Unsupported architecture: ${arch}`);
    }

    return `amass_${osName}_${goArch}`;
}

async function getLatestInfo() {
    return new Promise((resolve, reject) => {
        let data = [];
        const options = {
            hostname: 'api.github.com',
            path: '/repos/owasp-amass/amass/releases/latest',
            headers: {
                'User-Agent': 'Github Actions',
                // Inclui token se disponível
                ...(process.env.GITHUB_TOKEN && { 'Authorization': `token ${process.env.GITHUB_TOKEN}` })
            }
        };
        https.get(options, res => {
            const { statusCode } = res;
            if (statusCode !== 200) {
                reject(new Error(`Request Failed. Status Code: ${statusCode}`));
                res.resume();
                return;
            }
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => {
                try {
                    const releaseInfo = JSON.parse(data.join(''));
                    if (!releaseInfo.tag_name) {
                        reject(new Error("Invalid response: 'tag_name' not found"));
                    }
                    resolve(releaseInfo);
                } catch (error) {
                    reject(new Error('Failed to parse JSON response'));
                }
            });
        }).on('error', err => {
            reject(err);
        });
    });
}

async function getAssetDownloadUrl(selectedVersion, packageName) {
    const release = await getLatestInfo();
    const asset = release.assets.find(a => a.name === `${packageName}.zip`);
    if (!asset) {
        throw new Error(`Asset ${packageName}.zip not found in release ${selectedVersion}`);
    }
    return asset.browser_download_url;
}

export async function downloadAndInstall(version) {
    const toolName = "amass";
    const release = await getLatestInfo();
    const selectedVersion = version || release.tag_name;

    // Depuração para garantir que `selectedVersion` e `packageName` estão corretos
    if (!selectedVersion) {
        throw new Error("Version is undefined. Ensure 'getLatestInfo()' returned a valid release with 'tag_name'.");
    }

    const packageName = getPackage();
    if (!packageName) {
        throw new Error("Package name is undefined. Ensure 'getPackage()' returned a valid package.");
    }

    const url = await getAssetDownloadUrl(selectedVersion, packageName);
    core.info(`Download version ${selectedVersion} from ${url}.`);

    const downloadPath = await tc.downloadTool(url);
    if (!downloadPath) {
        throw new Error(`Unable to download Amass from ${url}.`);
    }

    const installDir = await tc.extractZip(downloadPath);
    if (!installDir) {
        throw new Error("Unable to extract Amass.");
    }

    const binPath = path.join(installDir, packageName, toolName);
    fs.chmodSync(binPath, "755");

    core.addPath(path.dirname(binPath));

    core.info(`Amass ${selectedVersion} was successfully installed to ${installDir}.`);
    core.endGroup();
    return binPath;
}
