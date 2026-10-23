const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const repository = 'megara-arevaco/agripa';
const releaseURL = `https://github.com/${repository}/releases`;
const maximumSize = 512 * 1024 * 1024;
function versionParts(version) {
  if (typeof version !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version)) throw new Error('updateVersionInvalid');
  return version.split('.').map(Number);
}
function newer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function selectRelease(release, current, arch = process.arch) {
  const version = String(release.tag_name || '').replace(/^v/, '');
  versionParts(version);
  if (release.draft || release.prerelease || !newer(version, current)) return { status: 'current', version: current };
  if (arch !== 'x64') return { status: 'unavailable', version, error: 'updateArchitecture' };
  const name = `Agripa-${version}.AppImage`;
  const asset = release.assets?.find(asset => asset.name === name && asset.state === 'uploaded');
  if (!asset) return { status: 'unavailable', version, error: 'updateNoPackage' };
  if (asset.browser_download_url !== `https://github.com/${repository}/releases/download/${release.tag_name}/${name}` || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maximumSize) throw new Error('updateMetadataInvalid');
  return { status: 'available', version, asset: { name, url: asset.browser_download_url, size: asset.size, digest: /^sha256:[a-f0-9]{64}$/.test(asset.digest) ? asset.digest.slice(7) : null } };
}
async function responseFrom(fetcher, url, signal, api = false) {
  const allowed = new Set(api ? ['api.github.com'] : ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
  for (let redirects = 0; redirects < 5; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !allowed.has(parsed.hostname)) throw new Error('updateOriginInvalid');
    const response = await fetcher(parsed.href, { redirect: 'manual', signal, headers: { Accept: api ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'Agripa-desktop' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('updateOriginInvalid');
      url = new URL(location, url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 404 ? 'updateNoRelease' : 'updateNetworkError'); }
    return response;
  }
  throw new Error('updateOriginInvalid');
}
function createUpdater({ version, directory, onChange = () => {}, fetcher = globalThis.fetch, arch = process.arch }) {
  let snapshot = { status: 'idle', version }, release, controller, readyFile;
  const publish = value => { snapshot = { ...value }; onChange({ ...snapshot }); return { ...snapshot }; };
  async function operation(callback) {
    if (controller) throw new Error('updateBusy');
    controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(() => controller?.abort(), 5 * 60 * 1000);
    try { return await callback(signal); }
    catch (error) { return publish(signal.aborted ? { status: release ? 'available' : 'idle', version: release?.version || version, canDownload: Boolean(release?.asset?.digest) } : { status: 'error', version, error: error.message.startsWith('update') ? error.message : 'updateNetworkError' }); }
    finally { clearTimeout(timeout); controller = null; }
  }
  return {
    state: () => ({ ...snapshot }), readyFile: () => readyFile,
    cancel() { controller?.abort(); },
    check() {
      return operation(async signal => {
        publish({ status: 'checking', version });
        const response = await responseFrom(fetcher, `https://api.github.com/repos/${repository}/releases/latest`, signal, true);
        const chunks = []; let bytes = 0;
        for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('updateMetadataInvalid'); chunks.push(Buffer.from(chunk)); }
        release = selectRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')), version, arch);
        return publish({ status: release.status, version: release.version, canDownload: Boolean(release.asset?.digest), error: release.error || (release.asset && !release.asset.digest ? 'updateNoDigest' : undefined) });
      });
    },
    download() {
      return operation(async signal => {
        if (!release?.asset?.digest) throw new Error('updateNoDigest');
        const asset = release.asset;
        publish({ status: 'downloading', version: release.version, progress: 0 });
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temporary = fs.mkdtempSync(path.join(directory, 'agripa-update-'));
        const partial = path.join(temporary, asset.name + '.part');
        try {
          const response = await responseFrom(fetcher, asset.url, signal);
          const hash = createHash('sha256'); let bytes = 0, previousProgress = -1;
          const meter = new Transform({ transform(chunk, _encoding, done) {
            bytes += chunk.length;
            if (bytes > asset.size || bytes > maximumSize) { done(new Error('updateSizeMismatch')); return; }
            hash.update(chunk);
            const progress = Math.floor(bytes / asset.size * 100);
            if (progress !== previousProgress) { previousProgress = progress; publish({ status: 'downloading', version: release.version, progress }); }
            done(null, chunk);
          } });
          await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal });
          if (bytes !== asset.size) throw new Error('updateSizeMismatch');
          if (hash.digest('hex') !== asset.digest) throw new Error('updateHashMismatch');
          const destination = path.join(temporary, asset.name);
          fs.renameSync(partial, destination); fs.chmodSync(destination, 0o700);
          readyFile = destination;
          return publish({ status: 'ready', version: release.version, progress: 100 });
        } catch (error) { fs.rmSync(temporary, { recursive: true, force: true }); throw error; }
      });
    }
  };
}
module.exports = { createUpdater, selectRelease, newer, responseFrom, releaseURL };
