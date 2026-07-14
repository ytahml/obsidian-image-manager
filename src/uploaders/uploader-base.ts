import { DEFAULT_UPLOAD_PATH_TEMPLATE } from '../types';
import { resolveUploadPath, selectUploadPathTemplate } from './upload-path';
import type { UploadResult, ImageHostingConfig, UploadContext } from '../types';

export abstract class UploaderBase {
    abstract readonly name: string;
    protected config: ImageHostingConfig;
    private readonly globalUploadPathTemplate: string;

    constructor(config: ImageHostingConfig, globalUploadPathTemplate = DEFAULT_UPLOAD_PATH_TEMPLATE) {
        this.config = config;
        this.globalUploadPathTemplate = globalUploadPathTemplate;
    }

    /** 上传图片文件 */
    abstract upload(
        data: ArrayBuffer,
        filename: string,
        context?: UploadContext
    ): Promise<UploadResult>;

    /** 测试图床连接 */
    abstract testConnection(): Promise<boolean>;

    protected getUploadPathTemplate(): string {
        return selectUploadPathTemplate(this.config.uploadPath, this.globalUploadPathTemplate);
    }

    protected resolveUploadPath(
        filename: string,
        data?: ArrayBuffer,
        context?: UploadContext,
        template = this.getUploadPathTemplate()
    ): Promise<string> {
        return resolveUploadPath(template, filename, data, context);
    }
}
