import type { UploadResult, ImageHostingConfig } from '../types';

export abstract class UploaderBase {
    abstract readonly name: string;
    protected config: ImageHostingConfig;

    constructor(config: ImageHostingConfig) {
        this.config = config;
    }

    /** 上传图片文件 */
    abstract upload(data: ArrayBuffer, filename: string, sourcePath?: string): Promise<UploadResult>;

    /** 测试图床连接 */
    abstract testConnection(): Promise<boolean>;
}
