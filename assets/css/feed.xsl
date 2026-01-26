<?xml version="1.0" encoding="utf-8"?>
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <title><xsl:value-of select="/atom:feed/atom:title"/> RSS Feed</title>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
        <style type="text/css">
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", Arial, sans-serif; color: #333; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
          a { color: #007bff; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .header { margin-bottom: 40px; border-bottom: 1px solid #ddd; padding-bottom: 20px; text-align: center; }
          .header h1 { margin: 0 0 10px; font-size: 2em; }
          .header p { color: #666; font-style: italic; }
          .entry { background: #fff; padding: 25px; margin-bottom: 20px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
          .entry h3 { margin-top: 0; margin-bottom: 10px; font-size: 1.5em; }
          .entry h3 a { color: #333; }
          .entry h3 a:hover { color: #007bff; }
          .meta { color: #999; font-size: 0.9em; margin-bottom: 15px; }
          .intro { margin-bottom: 40px; background-color: #e9ecef; padding: 20px; border-radius: 5px; text-align: center; color: #495057; font-size: 0.95em; }
          .intro a { font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="intro">
          <p><strong>This is an RSS feed.</strong> Subscribe by copying the URL into your news reader.</p>
          <p>Visit the website: <a href="{/atom:feed/atom:link[@rel='alternate']/@href}"><xsl:value-of select="/atom:feed/atom:title"/></a></p>
        </div>
        <div class="header">
          <h1><xsl:value-of select="/atom:feed/atom:title"/></h1>
          <p><xsl:value-of select="/atom:feed/atom:subtitle"/></p>
        </div>
        <xsl:for-each select="/atom:feed/atom:entry">
          <div class="entry">
            <h3>
              <a href="{atom:link[@rel='alternate']/@href}">
                <xsl:value-of select="atom:title"/>
              </a>
            </h3>
            <div class="meta">
              Published on <xsl:value-of select="substring(atom:published, 0, 11)"/>
            </div>
            <div class="summary">
               <xsl:value-of select="substring(atom:content, 0, 300)" disable-output-escaping="yes" />...
            </div>
          </div>
        </xsl:for-each>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
