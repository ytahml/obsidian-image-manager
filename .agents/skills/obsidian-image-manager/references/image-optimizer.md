# 图片压缩与格式转换

## 文件：`src/utils/image-optimizer.ts`

## ImageOptimizer 类

```typescript
class ImageOptimizer {
    constructor(app: App);

    // 压缩图片
    compressImage(file: TFile, quality: number): Promise<OptimizeResult>;

    // 转换格式
    convertFormat(file: TFile, targetFormat: 'webp' | 'jpg' | 'png'): Promise<OptimizeResult>;

    // 获取图片尺寸
    getImageInfo(file: TFile): Promise<{ width: number; height: number }>;
}
```

## OptimizeResult 接口

```typescript
interface OptimizeResult {
    data: ArrayBuffer;       // 压缩/转换后的二进制数据
    originalSize: number;    // 原始大小（字节）
    optimizedSize: number;   // 优化后大小（字节）
    format: string;          // 输出格式
}
```

## 压缩流程：`compressImage`

```
读取文件二进制数据
  → SVG 直接返回（不支持 canvas 压缩）
  → Blob → Image（URL.createObjectURL）
  → Canvas 绘制（保持原始尺寸）
  → PNG → WebP（更好的压缩率）
  → 其他格式保持原格式
  → canvas.toBlob(mimeType, quality/100)
  → URL.revokeObjectURL 释放内存
  → 返回 OptimizeResult
```

### 关键细节

1. **SVG 跳过**：Canvas API 不支持 SVG 压缩，直接返回原数据
2. **PNG → WebP**：PNG 不支持质量参数，转为 WebP 获得更好的压缩
3. **质量归一化**：`quality` 参数 1-100，内部转为 0-1
4. **内存管理**：使用后必须 `URL.revokeObjectURL(img.src)`
5. **DOM helper**：独立 Canvas 使用 Obsidian 全局 `createEl('canvas')` 创建，避免官方 `prefer-create-el` 告警

## 格式转换：`convertFormat`

```
读取文件二进制数据
  → SVG 抛出错误
  → 同格式直接返回
  → Blob → Image → Canvas
  → JPG 目标：处理透明度（alpha → 白色背景）
  → canvas.toBlob(targetMime, 0.92)
  → 返回 OptimizeResult
```

### JPG 透明度处理

JPG 不支持透明度，转换时将 alpha 通道混合为白色背景：
```typescript
if (targetFormat === 'jpg') {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! < 255) {
            const alpha = pixels[i + 3]! / 255;
            pixels[i] = Math.round(pixels[i]! * alpha + 255 * (1 - alpha));
            pixels[i + 1] = Math.round(pixels[i + 1]! * alpha + 255 * (1 - alpha));
            pixels[i + 2] = Math.round(pixels[i + 2]! * alpha + 255 * (1 - alpha));
            pixels[i + 3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
}
```

## 辅助函数

### `canvasToBlob`

```typescript
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
            type,
            quality
        );
    });
}
```

### `getMimeType`

扩展名 → MIME 类型映射（10 种格式）。

## 使用场景

| 场景 | 调用方法 | 说明 |
|------|----------|------|
| 粘贴时压缩 | `savePastedImage` 内联代码 | `src/main.ts` |
| 上传前压缩 | `compressImage(file, quality)` | `src/main.ts` |
| 批量上传压缩 | `compressImage(file, quality)` | `src/uploaders/upload-queue.ts` |
| 手动压缩命令 | `compressImage(file, quality)` | `src/main.ts` |
| 自定义上传引用宽高 | 模板实际使用 `{fileWidth}` / `{fileHeight}` 时调用 `getImageInfo` | `src/main.ts` |

## 性能考虑

1. **Canvas API**：浏览器端压缩，不依赖外部库
2. **内存**：大图片可能消耗大量内存，使用后立即释放
3. **异步**：所有操作都是异步的，不阻塞 UI
4. **SVG 跳过**：避免无意义的 canvas 操作

## 限制

1. **SVG 不支持**：Canvas API 无法压缩 SVG
2. **GIF 动画**：Canvas 只绘制第一帧，会丢失动画
3. **大图片**：可能触发浏览器内存限制
4. **质量损失**：有损压缩会降低图片质量

自定义引用模板不使用宽高变量时不得读取尺寸。若模板使用宽高但 `getImageInfo` 无法返回正整数尺寸，上传仍视为成功，该次自定义引用安全回退为默认 Markdown。
