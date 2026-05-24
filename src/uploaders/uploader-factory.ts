import type { ImageHostingConfig } from '../types';
import type { UploaderBase } from './uploader-base';
import { SmmsUploader } from './smms';
import { AliyunOSSUploader } from './aliyun-oss';
import { QiniuUploader } from './qiniu';
import { S3Uploader } from './s3-compatible';
import { CustomUploader } from './custom-uploader';

export function createUploader(config: ImageHostingConfig): UploaderBase {
    switch (config.type) {
        case 'smms':
            return new SmmsUploader(config);
        case 'aliyun-oss':
            return new AliyunOSSUploader(config);
        case 'qiniu':
            return new QiniuUploader(config);
        case 's3':
            return new S3Uploader(config);
        case 'custom':
            return new CustomUploader(config);
        default:
            throw new Error(`Unknown uploader type: ${config.type}`);
    }
}
