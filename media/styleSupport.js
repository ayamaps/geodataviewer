(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.GeoDataViewerStyleSupport = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SUPPORTED_STYLE_TYPES = new Set(["positron", "darkmatter"]);

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeFallbackStyleType(fallbackStyleType) {
    return SUPPORTED_STYLE_TYPES.has(fallbackStyleType)
      ? fallbackStyleType
      : "positron";
  }

  function hasCustomMapStyle(mapStyle, styleType) {
    if (!isObject(mapStyle) || typeof styleType !== "string" || !styleType) {
      return false;
    }

    const mapStyles = mapStyle.mapStyles;
    if (!isObject(mapStyles)) {
      return false;
    }

    const styleEntry = mapStyles[styleType];
    if (!isObject(styleEntry)) {
      return false;
    }

    return (
      (typeof styleEntry.url === "string" && styleEntry.url.length > 0) ||
      isObject(styleEntry.style)
    );
  }

  function resolveStyleType(styleType, mapStyle, fallbackStyleType) {
    if (typeof styleType === "string" && styleType.length > 0) {
      if (SUPPORTED_STYLE_TYPES.has(styleType)) {
        return styleType;
      }
      if (hasCustomMapStyle(mapStyle, styleType)) {
        return styleType;
      }
    }

    return normalizeFallbackStyleType(fallbackStyleType);
  }

  function applyStyleTypeFallback(configWrapper, fallbackStyleType) {
    if (!isObject(configWrapper)) {
      return {
        configWrapper,
        didFallback: false,
        originalStyleType: undefined,
        resolvedStyleType: normalizeFallbackStyleType(fallbackStyleType),
      };
    }

    const config = isObject(configWrapper.config)
      ? configWrapper.config
      : configWrapper;
    const mapStyle = isObject(config.mapStyle) ? config.mapStyle : {};
    const originalStyleType =
      typeof mapStyle.styleType === "string" ? mapStyle.styleType : undefined;
    const resolvedStyleType = resolveStyleType(
      originalStyleType,
      mapStyle,
      fallbackStyleType,
    );

    const nextConfig = {
      ...config,
      mapStyle: {
        ...mapStyle,
        styleType: resolvedStyleType,
      },
    };

    return {
      configWrapper: isObject(configWrapper.config)
        ? {
            ...configWrapper,
            config: nextConfig,
          }
        : nextConfig,
      didFallback:
        typeof originalStyleType === "string" &&
        originalStyleType.length > 0 &&
        originalStyleType !== resolvedStyleType,
      originalStyleType,
      resolvedStyleType,
    };
  }

  return {
    applyStyleTypeFallback,
    hasCustomMapStyle,
    normalizeFallbackStyleType,
    resolveStyleType,
    supportedStyleTypes: Array.from(SUPPORTED_STYLE_TYPES),
  };
});
