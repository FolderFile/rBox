import { Box, Typography } from '@mui/material'

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
      <Box
        component="img"
        src="/logo.png"
        alt="rBox logo"
        sx={{ width: size, height: size, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }}
      />
      <Typography
        component="span"
        sx={{
          fontFamily: '"Inter", sans-serif',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          fontSize: size * 0.82,
          lineHeight: 1,
          color: 'text.primary',
        }}
      >
        r
        <Box
          component="span"
          sx={{ color: t => (t.palette.mode === 'dark' ? '#ffffff' : t.palette.text.primary) }}
        >
          B
        </Box>
        ox
      </Typography>
    </Box>
  )
}
