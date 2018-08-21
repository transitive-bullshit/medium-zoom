const isSupported = node => node.tagName === 'IMG'

/* eslint-disable no-prototype-builtins */
const isListOrCollection = selector =>
  NodeList.prototype.isPrototypeOf(selector) ||
  HTMLCollection.prototype.isPrototypeOf(selector)
/* eslint-enable no-prototype-builtins */

const isNode = selector => selector && selector.nodeType === 1

const isSvg = image => {
  const source = image.currentSrc || image.src
  return source.substr(-4).toLowerCase() === '.svg'
}

const getImagesFromSelector = selector => {
  try {
    if (Array.isArray(selector)) {
      return selector.filter(isSupported)
    }

    if (isListOrCollection(selector)) {
      return Array.apply(null, selector).filter(isSupported)
    }

    if (isNode(selector)) {
      return [selector].filter(isSupported)
    }

    if (typeof selector === 'string') {
      return Array.apply(null, document.querySelectorAll(selector)).filter(
        isSupported
      )
    }

    return []
  } catch (err) {
    throw new TypeError(
      'The provided selector is invalid.\n' +
        'Expects a CSS selector, a Node element, a NodeList, an HTMLCollection or an array.\n' +
        'See: https://github.com/francoischalifour/medium-zoom'
    )
  }
}

const createOverlay = background => {
  const overlay = document.createElement('div')
  overlay.classList.add('medium-zoom-overlay')
  overlay.style.backgroundColor = background

  return overlay
}

const cloneTarget = template => {
  const { top, left, width, height } = template.getBoundingClientRect()
  const clone = template.cloneNode()
  const scrollTop =
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  const scrollLeft =
    window.pageXOffset ||
    document.documentElement.scrollLeft ||
    document.body.scrollLeft ||
    0

  clone.removeAttribute('id')
  clone.style.position = 'absolute'
  clone.style.top = `${top + scrollTop}px`
  clone.style.left = `${left + scrollLeft}px`
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.transform = ''

  return clone
}

const createCustomEvent = (type, params = {}) => {
  const eventParams = {
    bubbles: false,
    cancelable: false,
    detail: undefined,
    ...params,
  }

  if (typeof window.CustomEvent === 'function') {
    return new CustomEvent(type, eventParams)
  }

  const customEvent = document.createEvent('CustomEvent')
  customEvent.initCustomEvent(
    type,
    eventParams.bubbles,
    eventParams.cancelable,
    eventParams.detail
  )

  return customEvent
}

/**
 * Attaches a zoom effect on a selection of images.
 *
 * @param {(string|Element[])} selector The selector to target the images to attach the zoom to
 * @param {object} options The options of the zoom
 * @param {number} [options.margin=0] The space outside the zoomed image
 * @param {string} [options.background="#fff"] The color of the overlay
 * @param {number} [options.scrollOffset=48] The number of pixels to scroll to close the zoom
 * @param {(string|Element|object)} [options.container=null] The element to render the zoom in or a viewport object
 * @param {(string|Element)} [options.template=null] The template element to show on zoom
 * @return The zoom object
 */
const mediumZoom = (selector, options = {}) => {
  function _handleClick(event) {
    event.preventDefault()

    const { target } = event

    if (images.indexOf(target) === -1) {
      return
    }

    toggle({ target })
  }

  function _handleScroll() {
    if (isAnimating || !active.original) {
      return
    }

    const currentScroll =
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0

    if (Math.abs(scrollTop - currentScroll) > zoomOptions.scrollOffset) {
      setTimeout(close, 150)
    }
  }

  function _handleKeyUp(event) {
    // Close if escape key is pressed
    if ((event.keyCode || event.which) === 27) {
      close()
    }
  }

  function update(options = {}) {
    const newOptions = options

    if (options.background) {
      overlay.style.backgroundColor = options.background
    }

    if (options.container && options.container instanceof Object) {
      newOptions.container = {
        ...zoomOptions.container,
        ...options.container,
      }
    }

    if (options.template) {
      const template = isNode(options.template)
        ? options.template
        : document.querySelector(options.template)

      newOptions.template = template
    }

    zoomOptions = { ...zoomOptions, ...newOptions }

    images.forEach(image => {
      image.dispatchEvent(
        createCustomEvent('medium-zoom:update', {
          detail: { zoom },
        })
      )
    })

    return zoom
  }

  function extend(options = {}) {
    return mediumZoom({ ...zoomOptions, ...options })
  }

  function attach(...selectors) {
    const newImages = selectors.reduce(
      (imagesAccumulator, currentSelector) => [
        ...imagesAccumulator,
        ...getImagesFromSelector(currentSelector),
      ],
      []
    )

    newImages
      .filter(newImage => images.indexOf(newImage) === -1)
      .forEach(newImage => {
        images.push(newImage)
        newImage.classList.add('medium-zoom-image')
      })

    return zoom
  }

  function detach(...selectors) {
    if (active.zoomed) {
      close()
    }

    const imagesToDetach =
      selectors.length > 0
        ? selectors.reduce(
            (imagesAccumulator, currentSelector) => [
              ...imagesAccumulator,
              ...getImagesFromSelector(currentSelector),
            ],
            []
          )
        : images

    imagesToDetach.forEach(image => {
      image.classList.remove('medium-zoom-image')
      image.dispatchEvent(
        createCustomEvent('medium-zoom:detach', {
          detail: { zoom },
        })
      )
    })

    images = images.filter(image => imagesToDetach.indexOf(image) === -1)

    return zoom
  }

  function on(type, listener, options = {}) {
    images.forEach(image => {
      image.addEventListener(`medium-zoom:${type}`, listener, options)
    })

    return zoom
  }

  function off(type, listener, options = {}) {
    images.forEach(image => {
      image.removeEventListener(`medium-zoom:${type}`, listener, options)
    })

    return zoom
  }

  function open({ target } = {}) {
    const _animate = () => {
      if (!active.original) {
        return
      }

      let container = {
        width: window.innerWidth,
        height: window.innerHeight,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      }
      let viewportWidth
      let viewportHeight

      if (zoomOptions.container) {
        if (zoomOptions.container instanceof Object) {
          // The container is given as an object with properties like width, height, left, top
          container = {
            ...container,
            ...zoomOptions.container,
          }

          // We need to adjust custom options like container.right or container.bottom
          viewportWidth =
            container.width -
            container.left -
            container.right -
            zoomOptions.margin * 2
          viewportHeight =
            container.height -
            container.top -
            container.bottom -
            zoomOptions.margin * 2
        } else {
          // The container is given as an element
          const zoomContainer = isNode(zoomOptions.container)
            ? zoomOptions.container
            : document.querySelector(zoomOptions.container)

          const {
            width,
            height,
            left,
            top,
          } = zoomContainer.getBoundingClientRect()

          container = {
            ...container,
            width,
            height,
            left,
            top,
          }
        }
      }

      viewportWidth = viewportWidth || container.width - zoomOptions.margin * 2
      viewportHeight =
        viewportHeight || container.height - zoomOptions.margin * 2

      const zoomTarget = active.zoomedHd || active.original
      const naturalWidth = isSvg(zoomTarget)
        ? viewportWidth
        : zoomTarget.naturalWidth || viewportWidth
      const naturalHeight = isSvg(zoomTarget)
        ? viewportHeight
        : zoomTarget.naturalHeight || viewportHeight
      const { top, left, width, height } = zoomTarget.getBoundingClientRect()

      const scaleX = Math.min(naturalWidth, viewportWidth) / width
      const scaleY = Math.min(naturalHeight, viewportHeight) / height
      const scale = Math.min(scaleX, scaleY) || 1
      const translateX =
        (-left +
          (viewportWidth - width) / 2 +
          zoomOptions.margin +
          container.left) /
        scale
      const translateY =
        (-top +
          (viewportHeight - height) / 2 +
          zoomOptions.margin +
          container.top) /
        scale
      const transform = `scale(${scale}) translate3d(${translateX}px, ${translateY}px, 0)`

      active.zoomed.style.transform = transform

      if (active.zoomedHd) {
        active.zoomedHd.style.transform = transform
      }
    }

    return new Promise(resolve => {
      const _handleOpenEnd = () => {
        isAnimating = false
        active.zoomed.removeEventListener('transitionend', _handleOpenEnd)
        active.original.dispatchEvent(
          createCustomEvent('medium-zoom:opened', {
            detail: { zoom },
          })
        )

        resolve(zoom)
      }

      if (active.zoomed) {
        resolve(zoom)
        return
      }

      if (target) {
        // The zoom was triggered manually via a click
        active.original = target
      } else if (images.length > 0) {
        // The zoom was triggered programmatically, select the first image in the list
        ;[active.original] = images
      } else {
        resolve(zoom)
        return
      }

      active.original.dispatchEvent(
        createCustomEvent('medium-zoom:open', {
          detail: { zoom },
        })
      )

      scrollTop =
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0
      isAnimating = true
      active.zoomed = cloneTarget(active.original)

      document.body.appendChild(overlay)

      if (zoomOptions.template) {
        const template = isNode(zoomOptions.template)
          ? zoomOptions.template
          : document.querySelector(zoomOptions.template)
        active.template = document.createElement('div')
        active.template.appendChild(template.content.cloneNode(true))

        document.body.appendChild(active.template)
      }

      document.body.appendChild(active.zoomed)

      window.requestAnimationFrame(() => {
        document.body.classList.add('medium-zoom--open')
      })

      active.original.style.visibility = 'hidden'
      active.zoomed.classList.add('medium-zoom-image--open')

      active.zoomed.addEventListener('click', close)
      active.zoomed.addEventListener('transitionend', _handleOpenEnd)

      if (active.original.getAttribute('data-zoom-target')) {
        active.zoomedHd = active.zoomed.cloneNode()

        // Reset the `scrset` property or the HD image won't load.
        active.zoomedHd.removeAttribute('srcset')
        active.zoomedHd.removeAttribute('sizes')

        active.zoomedHd.src = active.zoomed.getAttribute('data-zoom-target')

        active.zoomedHd.onerror = () => {
          clearInterval(getZoomTargetSize)
          console.warn(
            `Unable to reach the zoom image target ${active.zoomedHd.src}`
          )
          active.zoomedHd = null
          _animate()
        }

        // We need to access the natural size of the full HD
        // target as fast as possible to compute the animation.
        const getZoomTargetSize = setInterval(() => {
          if (active.zoomedHd.naturalWidth) {
            clearInterval(getZoomTargetSize)
            active.zoomedHd.classList.add('medium-zoom-image--open')
            active.zoomedHd.addEventListener('click', close)
            document.body.appendChild(active.zoomedHd)
            _animate()
          }
        }, 10)
      } else if (active.original.hasAttribute('srcset')) {
        // If an image has a `srcset` attribuet, we don't know the dimensions of the
        // zoomed (HD) image (like when `data-zoom-target` is specified).
        // Therefore the approach is quite similar.
        active.zoomedHd = active.zoomed.cloneNode()

        // Resetting the sizes attribute tells the browser to load the
        // image best fitting the current viewport size, respecting the `srcset`.
        active.zoomedHd.removeAttribute('sizes')

        // Wait for the load event of the hd image. This will fire if the image
        // is already cached.
        const loadEventListener = active.zoomedHd.addEventListener(
          'load',
          () => {
            active.zoomedHd.removeEventListener('load', loadEventListener)
            active.zoomedHd.classList.add('medium-zoom-image--open')
            active.zoomedHd.addEventListener('click', close)
            document.body.appendChild(active.zoomedHd)
            _animate()
          }
        )
      } else {
        _animate()
      }
    })
  }

  function close() {
    return new Promise(resolve => {
      if (isAnimating || !active.original) {
        resolve(zoom)
        return
      }

      const _handleCloseEnd = () => {
        if (!active.original) {
          resolve(zoom)
          return
        }

        active.original.style.visibility = ''
        document.body.removeChild(active.zoomed)
        if (active.zoomedHd) {
          document.body.removeChild(active.zoomedHd)
        }
        document.body.removeChild(overlay)
        active.zoomed.classList.remove('medium-zoom-image--open')
        if (active.template) {
          document.body.removeChild(active.template)
        }

        isAnimating = false
        active.zoomed.removeEventListener('transitionend', _handleCloseEnd)

        active.original.dispatchEvent(
          createCustomEvent('medium-zoom:closed', {
            detail: { zoom },
          })
        )

        active.original = null
        active.zoomed = null
        active.zoomedHd = null
        active.template = null

        resolve(zoom)
      }

      isAnimating = true
      document.body.classList.remove('medium-zoom--open')
      active.zoomed.style.transform = ''

      if (active.zoomedHd) {
        active.zoomedHd.style.transform = ''
      }

      // Fade out the template so it's not too abrupt
      if (active.template) {
        active.template.style.transition = 'opacity 150ms'
        active.template.style.opacity = 0
      }

      active.original.dispatchEvent(
        createCustomEvent('medium-zoom:close', {
          detail: { zoom },
        })
      )

      active.zoomed.addEventListener('transitionend', _handleCloseEnd)
    })
  }

  function toggle({ target } = {}) {
    if (active.original) {
      return close()
    }

    return open({ target })
  }

  const getOptions = () => zoomOptions

  const getImages = () => images

  const getActive = () => active.original

  let images = []
  let isAnimating = false
  let scrollTop = 0
  let active = {
    original: null,
    zoomed: null,
    zoomedHd: null,
    template: null,
  }
  let zoomOptions = options

  // If the selector is omitted, it's replaced by the options
  if (
    selector instanceof Object &&
    !Array.isArray(selector) &&
    !isNode(selector) &&
    !isListOrCollection(selector)
  ) {
    zoomOptions = selector
  } else if (
    selector ||
    typeof selector === 'string' // to process empty string as a selector
  ) {
    attach(selector)
  }

  // Apply the default option values
  zoomOptions = {
    margin: 0,
    background: '#fff',
    scrollOffset: 48,
    container: null,
    template: null,
    ...zoomOptions,
  }

  const overlay = createOverlay(zoomOptions.background)

  overlay.addEventListener('click', close)
  document.addEventListener('click', _handleClick)
  document.addEventListener('scroll', _handleScroll)
  document.addEventListener('keyup', _handleKeyUp)
  window.addEventListener('resize', close)

  const zoom = {
    open,
    close,
    toggle,
    update,
    extend,
    attach,
    detach,
    on,
    off,
    getOptions,
    getImages,
    getActive,
  }

  return zoom
}

export default mediumZoom
