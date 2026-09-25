import { describe, expect, it } from 'vitest';
import { thumbUrl } from './ImageLightbox';

describe('thumbUrl', () => {
  it('inserts a width-limited transformation into Cloudinary upload URLs', () => {
    expect(thumbUrl('https://res.cloudinary.com/domztu6qv/image/upload/v1719/abc123.jpg', 360))
      .toBe('https://res.cloudinary.com/domztu6qv/image/upload/c_limit,w_360,q_auto,f_auto/v1719/abc123.jpg');
  });

  it('keeps folders in the public id', () => {
    expect(thumbUrl('https://res.cloudinary.com/demo/image/upload/v1/crisis/log/pic.png', 720))
      .toBe('https://res.cloudinary.com/demo/image/upload/c_limit,w_720,q_auto,f_auto/v1/crisis/log/pic.png');
  });

  it('leaves data: URLs unchanged', () => {
    const data = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    expect(thumbUrl(data, 360)).toBe(data);
  });

  it('leaves other URLs unchanged', () => {
    for (const url of [
      'https://example.com/image/upload/pic.jpg',
      'http://res.cloudinary.com/demo/image/upload/v1/pic.jpg',
      'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
      'https://res.cloudinary.com/demo/image/upload/',
    ]) {
      expect(thumbUrl(url, 360)).toBe(url);
    }
  });
});
