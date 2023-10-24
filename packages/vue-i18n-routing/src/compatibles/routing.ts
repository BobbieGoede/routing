import { isString, assign } from '@intlify/shared'
import { withTrailingSlash, withoutTrailingSlash } from 'ufo'
import { isVue3, unref, isVue2 } from 'vue-demi'

import { DEFAULT_DYNAMIC_PARAMS_KEY } from '../constants'
import { getLocale, getLocaleRouteName, getRouteName } from '../utils'

import {
  getI18nRoutingOptions,
  isV4Route,
  resolve,
  resolveBridgeRoute,
  resolvedRouteToObject,
  routeToObject
} from './utils'

import type { RoutingProxy, PrefixableOptions, SwitchLocalePathIntercepter } from './types'
import type { Strategies, I18nRoutingOptions } from '../types'
import type { Locale } from '@intlify/vue-i18n-bridge'
import type {
  Route,
  RawLocation,
  RouteLocationRaw,
  RouteLocationNormalizedLoaded,
  Router,
  RouteLocationPathRaw,
  RouteLocationNamedRaw
} from '@intlify/vue-router-bridge'

const RESOLVED_PREFIXED = new Set<Strategies>(['prefix_and_default', 'prefix_except_default'])

function prefixable(optons: PrefixableOptions): boolean {
  const { currentLocale, defaultLocale, strategy } = optons
  const isDefaultLocale = currentLocale === defaultLocale
  // don't prefix default locale
  return (
    !(isDefaultLocale && RESOLVED_PREFIXED.has(strategy)) &&
    // no prefix for any language
    !(strategy === 'no_prefix')
  )
}

export const DefaultPrefixable = prefixable

/**
 * Returns base name of current (if argument not provided) or passed in route.
 * 
 * @remarks
 * Base name is name of the route without locale suffix and other metadata added by nuxt i18n module

 * @param this - A {@link RoutingProxy} instance.
 * @param givenRoute - A route.
 * 
 * @returns The route base name. if cannot get, `undefined` is returned.
 * 
 * @public
 */
export function getRouteBaseName(
  this: RoutingProxy,
  givenRoute?: Route | RouteLocationNormalizedLoaded
): string | undefined {
  const router = this.router
  const { routesNameSeparator } = getI18nRoutingOptions(router, this)
  const route = unref(givenRoute) ?? this.route

  if (route == null || !route.name) {
    return
  }

  const name = getRouteName(route.name)
  return name.split(routesNameSeparator)[0]
}

/**
 * Returns localized path for passed in route.
 *
 * @remarks
 * If locale is not specified, uses current locale.
 *
 * @param this - A {@link RoutingProxy} instance.
 * @param route - A route.
 * @param locale - A locale, optional.
 *
 * @returns A path of the current route.
 *
 * @public
 */
export function localePath(
  this: RoutingProxy,
  route: RawLocation | RouteLocationRaw,
  locale?: Locale // TODO: locale should be more type inference (completion)
): string {
  const localizedRoute = resolveRoute.call(this, route, locale)
  if (localizedRoute == null) return ''

  const resolvedRoute = resolveBridgeRoute(localizedRoute)
  // @ts-ignore prettier-ignore
  return resolvedRoute.route.redirectedFrom || resolvedRoute.route.fullPath
}

/**
 * Returns localized route for passed in `route` parameters.
 *
 * @remarks
 * If `locale` is not specified, uses current locale.
 *
 * @param this - A {@link RoutingProxy} instance.
 * @param route - A route.
 * @param locale - A locale, optional.
 *
 * @returns A route. if cannot resolve, `undefined` is returned.
 *
 * @public
 */
export function localeRoute(
  this: RoutingProxy,
  route: RawLocation | RouteLocationRaw,
  locale?: Locale // TODO: locale should be more type inference (completion)
): Route | ReturnType<Router['resolve']> | undefined {
  const resolved = resolveRoute.call(this, route, locale)
  if (resolved == null) return undefined

  return resolveBridgeRoute(resolved).route
}

/**
 * Returns localized location for passed in route parameters.
 *
 * @remarks
 * If `locale` is not specified, uses current locale.
 *
 * @param this - A {@link RoutingProxy} instance.
 * @param route - A route.
 * @param locale - A locale, optional.
 *
 * @returns A route location. if cannot resolve, `undefined` is returned.
 *
 * @public
 */
export function localeLocation(
  this: RoutingProxy,
  route: RawLocation | RouteLocationRaw,
  locale?: Locale // TODO: locale should be more type inference (completion)
) {
  const resolved = resolveRoute.call(this, route, locale)
  if (resolved == null) return undefined

  return isV4Route(resolved) ? resolved : resolved.location
}

export function resolveRoute(this: RoutingProxy, route: RawLocation | RouteLocationRaw, locale?: Locale) {
  const router = this.router
  const i18n = this.i18n

  const _locale = locale || getLocale(i18n)
  const { routesNameSeparator, defaultLocale, defaultLocaleRouteNameSuffix, strategy, trailingSlash, prefixable } =
    getI18nRoutingOptions(router, this)

  // if route parameter is a string, check if it's a path or name of route.
  let _route: Partial<RouteLocationPathRaw> & Partial<RouteLocationNamedRaw>
  if (typeof route === 'string') {
    // else use it as route name.
    _route = { name: route }

    if (route[0] === '/') {
      // if route parameter is a path, create route object with path.
      const [path, search] = route.split('?')
      const query = Object.fromEntries(new URLSearchParams(search))
      _route = { path, query }
    }
  } else {
    _route = route
  }

  let localizedRoute = assign({}, _route)

  if (localizedRoute.path && !localizedRoute.name) {
    let _resolvedRoute = null
    try {
      _resolvedRoute = resolve(router, localizedRoute, strategy, _locale)
    } catch {}
    const resolvedValue = resolveBridgeRoute(_resolvedRoute)
    const resolvedRouteName = getRouteBaseName.call(this, resolvedValue.route)

    if (isString(resolvedRouteName)) {
      localizedRoute = {
        name: getLocaleRouteName(resolvedRouteName, _locale, {
          defaultLocale,
          strategy,
          routesNameSeparator,
          defaultLocaleRouteNameSuffix
        }),
        params: resolvedValue.route?.params,
        query: resolvedValue.route?.query,
        hash: resolvedValue.route?.hash
      }

      if (resolvedValue.__version === 4) {
        // @ts-expect-error
        localizedRoute.state = resolvedValue.route?.state
      }
    } else {
      // if route has a path defined but no name, resolve full route using the path
      if (prefixable({ currentLocale: _locale, defaultLocale, strategy })) {
        localizedRoute.path = `/${_locale}${localizedRoute.path}`
      }

      localizedRoute.path = trailingSlash
        ? withTrailingSlash(localizedRoute.path, true)
        : withoutTrailingSlash(localizedRoute.path, true)
    }
  } else {
    if (!localizedRoute.name && !localizedRoute.path) {
      localizedRoute.name = getRouteBaseName.call(this, this.route)
    }

    localizedRoute.name = getLocaleRouteName(localizedRoute.name, _locale, {
      defaultLocale,
      strategy,
      routesNameSeparator,
      defaultLocaleRouteNameSuffix
    })

    if (isVue2) {
      const { params } = localizedRoute
      if (params && params['0'] === undefined && params.pathMatch) {
        params['0'] = params.pathMatch
      }
    }
  }

  try {
    const resolvedRouteObject = resolvedRouteToObject(router.resolve(localizedRoute))
    const resolvedRoute = resolveBridgeRoute(resolvedRouteObject)

    if (resolvedRoute.route?.name) {
      return resolvedRouteObject
    }

    // if didn't resolve to an existing route then just return resolved route based on original input.
    return (router as Router).resolve(route)
  } catch (e: unknown) {
    if (isVue3 && e != null && typeof e === 'object' && 'type' in e && (e?.type as number) === 1) {
      // `1` is No match
      return null
    } else if (isVue2) {
      return null
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const DefaultSwitchLocalePathIntercepter: SwitchLocalePathIntercepter = (path: string) => path

function getLocalizableMetaFromDynamicParams(
  route: Route | RouteLocationNormalizedLoaded,
  key: Required<I18nRoutingOptions>['dynamicRouteParamsKey']
): Record<Locale, Record<string, string>> {
  const metaDefault: Record<string | symbol, Record<string, string>> = {}
  if (key === DEFAULT_DYNAMIC_PARAMS_KEY) {
    return metaDefault
  }

  const meta = unref(route).meta || metaDefault

  return (unref(meta)[key] || metaDefault) as Record<Locale, Record<string, string>>
}

/**
 * Returns path of the current route for specified locale.
 *
 * @param this - A {@link RoutingProxy} instance.
 * @param locale - A locale
 *
 * @returns A path of the current route.
 *
 * @public
 */
export function switchLocalePath(this: RoutingProxy, locale: Locale): string {
  const route = this.route
  const name = getRouteBaseName.call(this, route)
  if (!name) {
    return ''
  }

  const { switchLocalePathIntercepter, dynamicRouteParamsKey } = getI18nRoutingOptions(this.router, this)

  const routeValue = unref(route)
  const routeCopy = routeToObject(routeValue)
  const langSwitchParams =
    getLocalizableMetaFromDynamicParams(route, dynamicRouteParamsKey)[locale] ||
    ({} as Record<string | symbol, Record<string, string>>)

  const _baseRoute = {
    name,
    params: {
      ...routeCopy.params,
      ...langSwitchParams
    }
  }

  if (isVue2) {
    _baseRoute.params[0] = routeCopy.params.pathMatch
  }

  const baseRoute = assign({}, routeCopy, _baseRoute)
  let path = localePath.call(this, baseRoute, locale)

  // custom locale path with interceptor
  path = switchLocalePathIntercepter(path, locale)

  return path
}
