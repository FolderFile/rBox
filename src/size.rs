use crate::error::{AppError, Result};

/// Parse "500MB", "10GB", "1.5GiB", or a plain byte count into bytes.
pub fn parse_size(input: &str) -> Result<u64> {
    let s = input.trim();
    let split = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '_'))
        .unwrap_or(s.len());
    let (num_part, unit_part) = s.split_at(split);
    let num: f64 = num_part
        .trim()
        .parse()
        .map_err(|_| AppError::InvalidSize(input.to_string()))?;
    if !(0.0..=i64::MAX as f64).contains(&num) {
        return Err(AppError::InvalidSize(input.to_string()));
    }
    let unit = unit_part.trim().to_ascii_uppercase().replace('_', "");
    let mult = match unit.as_str() {
        "" | "B" => 1.0,
        "KB" => 1e3,
        "MB" => 1e6,
        "GB" => 1e9,
        "TB" => 1e12,
        "KIB" => 1024.0,
        "MIB" => 1_048_576.0,
        "GIB" => 1_073_741_824.0,
        "TIB" => 1_099_511_627_776.0,
        _ => return Err(AppError::InvalidSize(input.to_string())),
    };
    let bytes = num * mult;
    if !bytes.is_finite() || bytes > i64::MAX as f64 {
        return Err(AppError::InvalidSize(input.to_string()));
    }
    Ok(bytes as u64)
}

/// Binary-unit human form, e.g. 5368709120 -> "5.0 GiB".
pub fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut v = bytes as f64;
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    format!("{v:.1} {}", UNITS[u])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_decimal_units() {
        assert_eq!(parse_size("500MB").unwrap(), 500_000_000);
        assert_eq!(parse_size("10GB").unwrap(), 10_000_000_000);
        assert_eq!(parse_size("2KB").unwrap(), 2_000);
    }

    #[test]
    fn parses_binary_units() {
        assert_eq!(parse_size("1GiB").unwrap(), 1_073_741_824);
        assert_eq!(parse_size("1.5MiB").unwrap(), 1_572_864);
        assert_eq!(parse_size("1073741824").unwrap(), 1_073_741_824);
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_size("abc").is_err());
        assert!(parse_size("10XB").is_err());
        assert!(parse_size("").is_err());
    }

    #[test]
    fn formats_bytes() {
        assert_eq!(format_size(512), "512 B");
        assert_eq!(format_size(1_073_741_824), "1.0 GiB");
    }
}
