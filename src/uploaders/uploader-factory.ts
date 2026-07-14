import { DEFAULT_UPLOAD_PATH_TEMPLATE } from '../types';
import type { ImageHostingConfig } from '../types';
import type { UploaderBase } from './uploader-base';
import { AliyunOSSUploader } from './aliyun-oss';
import { QiniuUploader } from './qiniu';
import { S3Uploader } from './s3-compatible';
import { CustomUploader } from './custom-uploader';

export function createUploader(
    config: ImageHostingConfig,
    globalUploadPathTemplate = DEFAULT_UPLOAD_PATH_TEMPLATE
): UploaderBase {
    switch (config.type) {
        case 'aliyun-oss':
            return new AliyunOSSUploader(config, globalUploadPathTemplate);
        case 'qiniu':
            return new QiniuUploader(config, globalUploadPathTemplate);
        case 's3':
            return new S3Uploader(config, globalUploadPathTemplate);
        case 'custom':
            return new CustomUploader(config);
        default:
            throw new Error(`Unknown uploader type: ${config.type as string}`);
    }
}
