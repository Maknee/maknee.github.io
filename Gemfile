source 'https://rubygems.org'
group :jekyll_plugins do
    gem 'classifier-reborn'
    # Pin Jekyll to a specific version to avoid unexpected resolver upgrades in CI
    gem 'jekyll', '4.4.1'
    gem 'jekyll-archives'
    gem 'jekyll-email-protect'
    gem 'jekyll-feed'
    gem 'jekyll-json-feed'
    gem 'jekyll-get-json'
    gem 'jekyll-imagemagick'
    gem 'jekyll-jupyter-notebook'
    gem 'jekyll-link-attributes'
    gem 'jekyll-minifier'
    gem 'jekyll-paginate-v2'
    gem 'jekyll-scholar'
    gem 'jekyll-sitemap'
    gem 'jekyll-tabs'
    gem 'jekyll-toc'
    gem 'jekyll-twitter-plugin'
    gem 'jemoji'
    gem 'mini_racer'
    gem 'unicode_utils'
    gem 'webrick'
end

# Workaround: jekyll-sass-converter (~> 3) depends on sass-embedded.
# Recent sass-embedded 1.93.3 is failing on GH Actions Linux runners.
# Pin to a known-good 1.93.2 across platforms to stabilize builds.
gem 'sass-embedded', '1.93.2'
group :other_plugins do
    gem 'css_parser'
    gem 'feedjira'
    gem 'httparty'
end
