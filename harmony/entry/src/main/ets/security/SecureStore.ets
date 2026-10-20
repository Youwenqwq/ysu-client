import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

interface Manifest { version: string; count: number; size: number; }

/** Secrets never enter Preferences, files, WebView cookies, backups, logs or cloud sync. */
export class SecureStore {
  private encoder: util.TextEncoder = new util.TextEncoder();
  private serial: Promise<void> = Promise.resolve();

  private alias(key: string): Uint8Array {
    if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(key)) throw new Error('Invalid storage key');
    return this.encoder.encodeInto(`ysu.harmony.${key}`);
  }

  private async readSecret(key: string): Promise<Uint8Array | null> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, this.alias(key));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const result = await asset.query(query);
      if (result.length !== 1) throw new Error('Invalid asset result');
      const secret = result[0].get(asset.Tag.SECRET);
      if (!(secret instanceof Uint8Array)) throw new Error('Invalid asset content');
      return secret;
    } catch (error) {
      if ((error as BusinessError).code === asset.ErrorCode.NOT_FOUND) return null;
      throw new Error('系统安全存储不可用');
    }
  }

  private async putSecret(key: string, value: Uint8Array): Promise<void> {
    const attributes: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    attributes.set(asset.Tag.ALIAS, this.alias(key));
    attributes.set(asset.Tag.SECRET, value);
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    // IS_PERSISTENT defaults to false. Do not set this permission-gated tag.
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    await asset.add(attributes);
  }

  private async deleteSecret(key: string): Promise<void> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, this.alias(key));
    try { await asset.remove(query); }
    catch (error) {
      if ((error as BusinessError).code !== asset.ErrorCode.NOT_FOUND) throw new Error('安全数据删除失败');
    }
  }

  private async manifest(key: string): Promise<Manifest | null> {
    const bytes = await this.readSecret(`${key}.manifest`);
    if (!bytes) return null;
    const record = JSON.parse(util.TextDecoder.create('utf-8').decodeToString(bytes)) as Manifest;
    if (!/^[a-zA-Z0-9-]+$/.test(record.version) || record.count < 1 || record.count > 256 ||
      !Number.isInteger(record.count) || !Number.isInteger(record.size) || record.size < 2 || record.size > 262144) {
      throw new Error('安全数据损坏');
    }
    return record;
  }

  get(key: string): Promise<string | null> {
    const next = this.serial.then(() => this.readValue(key));
    this.serial = next.then(() => {}, () => {});
    return next;
  }

  private async readValue(key: string): Promise<string | null> {
    const record = await this.manifest(key);
    if (!record) return null;
    const data = new Uint8Array(record.size);
    let offset = 0;
    for (let index = 0; index < record.count; index++) {
      const chunk = await this.readSecret(`${key}.${record.version}.${index}`);
      if (!chunk || offset + chunk.length > data.length) throw new Error('安全数据损坏');
      data.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== record.size) throw new Error('安全数据损坏');
    const value = JSON.parse(util.TextDecoder.create('utf-8').decodeToString(data)) as string;
    if (typeof value !== 'string') throw new Error('安全数据损坏');
    return value;
  }

  set(key: string, value: string): Promise<void> {
    const next = this.serial.then(async () => {
      const data = this.encoder.encodeInto(JSON.stringify(value));
      if (data.length > 262144) throw new Error('安全数据过大');
      const previous = await this.manifest(key);
      const version = util.generateRandomUUID();
      const count = Math.max(1, Math.ceil(data.length / 1024));
      let written = 0;
      try {
        for (let index = 0; index < count; index++) {
          await this.putSecret(`${key}.${version}.${index}`, data.slice(index * 1024, (index + 1) * 1024));
          written++;
        }
        const record: Manifest = { version, count, size: data.length };
        await this.putSecret(`${key}.manifest`, this.encoder.encodeInto(JSON.stringify(record)));
      } catch {
        for (let index = 0; index < written; index++) {
          await this.deleteSecret(`${key}.${version}.${index}`).catch(() => {});
        }
        throw new Error('凭据未能安全保存');
      }
      if (previous) await this.cleanup(key, previous).catch(() => {});
    });
    this.serial = next.catch(() => {});
    return next;
  }

  remove(key: string): Promise<void> {
    const next = this.serial.then(async () => {
      const record = await this.manifest(key);
      // Remove encrypted chunks before the manifest, allowing a failed deletion to be retried.
      if (record) await this.cleanup(key, record);
      await this.deleteSecret(`${key}.manifest`);
    });
    this.serial = next.catch(() => {});
    return next;
  }

  private async cleanup(key: string, record: Manifest): Promise<void> {
    for (let index = 0; index < record.count; index++) {
      await this.deleteSecret(`${key}.${record.version}.${index}`);
    }
  }
}
