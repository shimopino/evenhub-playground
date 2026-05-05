export async function loadImageBytes(
  url: string,
  width?: number,
  height?: number,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Image fetch failed ${res.status} ${res.statusText}`);
  }

  const blob = await res.blob();

  if (width !== undefined && height !== undefined) {
    // 画像をそのまま返すのではなく、ブラウザの canvas で
    // 指定サイズのキャンバスに描き直して、そこで拡大縮小する。
    // drawImage の第 5 引数以降に描画先サイズを渡すと、
    // 元画像は自動的に width x height にリサンプルされる。
    const objectUrl = URL.createObjectURL(blob);
    const canvas = document.createElement("canvas");
    try {
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas 2D context is not available");
      }

      const image = await loadImageElement(objectUrl);
      ctx.drawImage(image, 0, 0, width, height);

      // リサイズ済みの canvas を PNG にして、updateImageRawData に
      // 渡せる Uint8Array に戻す。
      const resizedBlob = await canvasToBlob(canvas, "image/png");
      return new Uint8Array(await resizedBlob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  // object URL から画像を読み込んで decode してから描画する。
  // これで canvas 側に自然に描けるようになる。
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  return image;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode canvas image"));
        return;
      }

      resolve(blob);
    }, type);
  });
}
