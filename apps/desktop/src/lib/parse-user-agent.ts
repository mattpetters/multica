export interface ParsedUA {
  browser: string
  os: string
}

export function parseUserAgent(ua: string): ParsedUA {
  let os = 'Unknown'
  if (/Mac OS X/.test(ua)) os = 'macOS'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/iPhone|iPad/.test(ua)) os = 'iOS'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Linux/.test(ua)) os = 'Linux'

  let browser = 'Unknown'
  const edgeMatch = ua.match(/Edg\/(\d+)/)
  const chromeMatch = ua.match(/Chrome\/(\d+)/)
  const safariMatch = ua.match(/Version\/(\d+).*Safari/)
  const firefoxMatch = ua.match(/Firefox\/(\d+)/)

  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`

  return { browser, os }
}
