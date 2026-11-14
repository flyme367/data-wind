//! Bookkeeping for an asynchronous scene readback.

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct PreviewFrame {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) pixels: Vec<u8>,
}

#[derive(Default)]
pub(crate) struct PreviewState {
    enabled: bool,
    generation: u64,
    in_flight: bool,
    frame: Option<PreviewFrame>,
    error: Option<String>,
}

impl PreviewState {
    pub(crate) fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.invalidate();
    }

    pub(crate) fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.frame = None;
        self.error = None;
    }

    pub(crate) fn begin(&mut self) -> Option<u64> {
        if !self.enabled || self.in_flight || self.frame.is_some() || self.error.is_some() {
            return None;
        }
        self.in_flight = true;
        Some(self.generation)
    }

    pub(crate) fn finish(&mut self, generation: u64, result: Result<PreviewFrame, String>) {
        self.in_flight = false;
        if !self.enabled || generation != self.generation {
            return;
        }
        match result {
            Ok(frame) => self.frame = Some(frame),
            Err(error) => self.error = Some(error),
        }
    }

    pub(crate) fn take(&mut self) -> Option<PreviewFrame> {
        self.frame.take()
    }

    pub(crate) fn take_error(&mut self) -> Option<String> {
        self.error.take()
    }
}

/// Remove wgpu's row padding and force an opaque alpha channel.
pub(crate) fn unpack_rows(
    bytes: &[u8],
    width: u32,
    height: u32,
    stride: u32,
    linear_surface: bool,
) -> Option<PreviewFrame> {
    let row_bytes = usize::try_from(width).ok()?.checked_mul(4)?;
    let stride = usize::try_from(stride).ok()?;
    let rows = usize::try_from(height).ok()?;
    if row_bytes == 0
        || rows == 0
        || row_bytes > stride
        || bytes.len() < stride.checked_mul(rows)?
    {
        return None;
    }
    let mut pixels = Vec::with_capacity(row_bytes.checked_mul(rows)?);
    for row in bytes.chunks_exact(stride).take(rows) {
        pixels.extend_from_slice(&row[..row_bytes]);
    }
    let mut linear = [0_u8; 256];
    if linear_surface {
        for (index, value) in linear.iter_mut().enumerate() {
            let srgb = index as f32 / 255.0;
            let decoded = if srgb <= 0.04045 {
                srgb / 12.92
            } else {
                ((srgb + 0.055) / 1.055).powf(2.4)
            };
            *value = (decoded * 255.0).round() as u8;
        }
    }
    for pixel in pixels.chunks_exact_mut(4) {
        if linear_surface {
            for channel in &mut pixel[..3] {
                *channel = linear[usize::from(*channel)];
            }
        }
        pixel[3] = 255;
    }
    Some(PreviewFrame {
        width,
        height,
        pixels,
    })
}
