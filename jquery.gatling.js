/*!
 *	Gatling Analytics v0.1.5
 *
 *	Copyright (c) 2010 Knewton
 *	Dual licensed under:
 *		MIT: http://www.opensource.org/licenses/mit-license.php
 *		GPLv3: http://www.opensource.org/licenses/gpl-3.0.html
 */

"use strict";

/*global window, jQuery */
 
/*jslint evil: true, white: true, browser: true, onevar: true, undef: true, eqeqeq: true, bitwise: true, strict: true, newcap: true, immed: true, maxerr: 50, indent: 4 */
 
(function ($) {
	
	//------------------------------
	//
	//	Constants
	//
	//------------------------------
	
		/**
		 *	The time the page loaded.
		 */
	var LOAD_START = new Date(),
	
		/**
		 *	CSS rules to create
		 */
		CSS_RULES = 
		[
			'.deferred-script-load{ display: none; }'
		],
	
	//------------------------------
	//
	//	Property Declaration
	//
	//------------------------------
	
		/**
		 *	Create a placeholder for the gatling object.
		 */
		_ = {},
	
		/**
		 *	Determine if the given string is a tag.
		 */
		RX_TAG = /<\/?\w+((\s+(\w|\w[\w\-]*\w)(\s*=\s*(?:\".*?\"|'.*?'|[^'\">\s]+))?)+\s*|\s*)\/?>/i,
	
		/**
		 *	Determine if we're running over a secure connection
		 */
		secure = document.location.protocol === 'https:',
		
		/**
		 *	Contains the named trackers used by gatling.
		 *
		 *	Signature;
		 *	{
		 *		<trackerName>: <trackerDefinition>,
		 *
		 *		...
		 *	}
		 */
		trackers = {},
		
		/**
		 *	Define a collection of listeners when a specific type of regex matches an included script.
		 *
		 *	Signature:
		 *	[
		 *		{
		 *			regex: <regexSignature>, 
		 *
		 *			listener: <listener>
		 *		},
		 *
		 *		...
		 *	]	   
		 */
		listenerHooks = [],
		
		/**
		 *	Define the properties for a default tracker.
		 */
		defaultTracker = 
		{
			//------------------------------
			//	Class Variables
			//------------------------------
		
			/**
			 *	The include path for a given engine.
			 */
			path: undefined,
			
			/**
			 *	A collection of global variables the tracker needs.
			 */
			globals: undefined,
			
			/**
			 *	A callback function to be notified when the script include finishes.
			 */
			loaded: undefined,
			
			/**
			 *	A prefix to append to the script path when on a non-secure connection.
			 */
			prefix: undefined,
			
			/**
			 *	A prefix to append to the script path when on a secure connection.
			 */
			securePrefix: undefined,
			
			/**
			 *	The path to the tracking pixel to use.
			 */
			image: undefined,
			
			/**
			 *	The tracker ID which identifies this object.
			 */
			trackerID: undefined,
			
			//------------------------------
			//	Instance Variables
			//------------------------------
			
			/**
			 *	A callback function to notify whenever the tracker initializes loads.
			 */
			ready: $.noop,
			
			/**
			 *	The parameters to append to a tracking pixel.
			 */
			params: undefined,
			
			/**
			 *	A collection of replacements to use when creating the path or image.
			 */
			replacements: undefined
		},
		
		/**
		 *	A collection of string replacements used to seed data into the engines.
		 */
		defaultReplacements = 
		{
			'trackerID': '%gatling-tracker-id%'
		},
		
		/**
		 *	Create an image object for pixel includes.
		 */
		imageLoader = new Image(),
		
		/**
		 *	The document writer.
		 */
		writer = document.write,
		
		/**
		 *	Allow the document.write interrupt
		 */
		allowInterrupt;
		
	//------------------------------
	//
	//	Internal Methods
	//
	//------------------------------
	
	/**
	 *	Handle the loading or injection of a script tag, based on whether or not it has a src attribute.
	 *
	 *	@param script	The script to load.
	 */
	function handleScriptLoad(script)
	{
		if (script.attr('src') === undefined)
		{
			script.appendTo('body');
		}
		else
		{
			var listener,
				buffer = [];
		
			$.each(listenerHooks, function ()
			{
				if (this.regex.test(script.attr('src')))
				{
					listener = this.listener;
				}
				else
				{
					buffer.push(this);
				}
			});
			
			listenerHooks = buffer;
		
			$.getScript(script.attr('src'), listener);
		}
	}
	
	/**
	 *	Intercept the document.write event to allow script tags loaded in this manner to be appended to the body properly.
	 *
	 *	@param string	The string to apply.
	 */
	function writeInterrupt(string)
	{
		if (!allowInterrupt)
		{
			writer.call(document, string);
			return;
		}
		
		if (RX_TAG.test(string))
		{
			var snippet = $(string);
			
			if (snippet.is('script'))
			{
				handleScriptLoad(snippet);
			}
			else
			{
				$('script', snippet).each(function ()
				{
					handleScriptLoad($(this));
				});
			}
			
			snippet.not('script').appendTo('body');
		}
		else
		{
			writer.call(document, string);
		}
	}
	
	/**
	 *	Create a query string for a tracker.
	 *
	 *	@param tracker	The tracker to create the query string for.
	 *
	 *	@return The query string.
	 */
	function createQueryString(params)
	{
		var buffer = [];
		
		$.each(params, function (key, value)
		{
			buffer.push(key + '=' + value);
		});
		
		return buffer.length > 0 ? ('?' + buffer.join('&')) : '';
	}
	
	/**
	 *	Extract params out of the tracker's params object and assign them as global variables.
	 *
	 *	@param tracker	The tracker to create global variables for.
	 *
	 *	@return The tracker params which aren't global vars.
	 */
	function extractGlobalVariables(tracker)
	{
		var buffer = {};
		
		$.each(tracker.params, function (key, value)
		{
			//	If the object is a global...
			if (tracker.globals[key] === true)
			{
				window[key] = value;
			}
			
			//	Otherwise, return it.
			else
			{
				buffer[key] = value;
			}
		});
		
		return buffer;
	}
	
	/**
	 *	Instantiate the tracker.
	 *
	 *	@param tracker	The tracker to instantiate.
	 */
	function instantiateTracker(tracker)
	{	 
			//	Create our base path.
		var source = 'http' + (secure ? 's' : '')  + '://',
		
			//	Create a buffer for unused properties, which will be query-string vars.
			buffer = {};

		//	If we have a secure prefix to apply, and we're secure, do so.
		if (tracker.securePrefix !== undefined && secure)
		{
			source += tracker.securePrefix;
		}
		
		//	Otherwise, if any prefix exists, append it
		else if (tracker.prefix !== undefined)
		{
			source += tracker.prefix;
		}
	
		//	Add the tracker's path or image to the source.
		source += tracker.path || tracker.image;
		
		//	Extract any global variables.
		tracker.params = extractGlobalVariables(tracker); 
		
		//	Add the tracker ID as a param, incase it's required.
		tracker.params = $.extend(tracker.params, {trackerID: tracker.trackerID});

		//	Run our replacements on the tracker's source.
		$.each(tracker.params, function (key, value)
		{
			if (tracker.replacements[key])
			{
				source = source.replace(tracker.replacements[key], value);
			}
			else
			{
				buffer[key] = value;
			}
		});

		//	Append any query string to the tracker source.
		source += createQueryString(buffer);
		
		allowInterrupt = true;
		
		if (tracker.path !== undefined)
		{
			//	Load the script resource.
			$.getScript(source, function ()
			{
				if ($.isFunction(tracker.loaded))
				{
					tracker.loaded(tracker);
				}
				else
				{
					tracker.ready(tracker);
				}
			});
		}
		else if (tracker.image !== undefined)
		{
			//	Load the tracking pixel.
			imageLoader.src = source;
			
			if ($.isFunction(tracker.loaded))
			{
				tracker.loaded(tracker);
			}
		}
	}
	
	//------------------------------
	//
	//	Class Definition
	//
	//------------------------------
	
	$.extend(_, {
	
		//------------------------------
		//	Properties
		//------------------------------
	
		/**
		 *	Keeps track of the time from the inclusion of gatling until the dom ready event.
		 */
		loadTime: 
		{
			/**
			 *	Date object representing the time the page load is considered to have started.
			 */
			start: undefined,
		
			/**
			 *	Date object representing the time the page load is considered to have ended.
			 */
			end: undefined
		},
	
		//------------------------------
		//	Methods
		//------------------------------
		
		/**
		 *	Create a gatling tracker.
		 *
		 *	@param name			The name of the tracker. Must be unique.
		 *
		 *	@param definition	The definition object for the tracker.
		 *
		 *	@param replacements An object of replacements to draw from the params.
		 */
		defineTracker: function (name, definition, replacements)
		{
			if (trackers[name] === undefined)
			{
				trackers[name] = $.extend(true, {}, defaultTracker, definition);
				trackers[name].replacements = $.extend({}, defaultReplacements, replacements);
				
				/**
				 *	Assign the global vars as a hash.
				 */
				var buffer = {};
				
				if (trackers[name].globals !== undefined)
				{
					$.each(trackers[name].globals, function ()
					{
						buffer[this] = true;
					});
				}
				
				trackers[name].globals = buffer;
			}
		},
		
		/**
		 *	Create a tracker instance.
		 *
		 *	@param type		The type of tracker to create.
		 *
		 *	@param id		The ID of this tracker instance.
		 *
		 *	@param listener The listener to notify when the tracker is ready.
		 *
		 *	@param params	The params to pass to the tracker.
		 *
		 *	@param loaded	A loading function.
		 *
		 *	@return The created tracker.
		 */
		createTracker: function (type, id, listener, params, loaded)
		{
			if (trackers[type] === undefined)
			{
				return false;
			}
			
			var tracker = $.extend(true, {}, trackers[type]);
			
			tracker.params = params || {};
			tracker.ready = $.isFunction(listener) ? listener : $.noop || function () {};
			tracker.trackerID = id;
			tracker.loaded = loaded || tracker.loaded;
			
			instantiateTracker(tracker);
			
			return tracker;
		},
		
		/**
		 *	Declare a collection of trackers.
		 *
		 *	@param definitions	An array of definitions for declaring trackers.
		 */
		declare: function (definitions)
		{
			$.each(definitions, function ()
			{
				_.defineTracker(this.name, this.definition, this.replacements);
			});
		},
		
		/**
		 *	Load a collection of trackers.
		 *
		 *	@param definitions	A collection of key-value pair objects containing the properties required.
		 *
		 *	@return A collection of the instanciated trackers.
		 */
		load: function (definitions)
		{
			var trackers = [];
		
			$.each(definitions, function ()
			{
				trackers.push(_.createTracker(this.type, this.id, this.listener, this.params, this.loaded));
			});
			
			return trackers;
		},
		
		/**
		 *	Setup a listener to be notified when a script matching a regex finishes loading.
		 *
		 *	@param regex	The regex to differentiate the script.
		 *
		 *	@param listener The listener to notify.
		 */
		scriptListener: function (regex, listener)
		{
			listenerHooks.push({regex: regex, listener: listener});
			
			return _;
		}
	});
	
	//------------------------------
	//
	//	Expose Closure Methods
	//
	//------------------------------
	
	$.gatling = _;
	
	/**
	 *	Fetch get parameters from the URL.
	 *
	 *	@param name The name of the parameter to get.
	 *
	 *	@return The parameter value, or undefined if none exists.
	 */
	$.urlParam = function (name)
	{
		var results = new RegExp('[\\?&]' + name + '=([^&#]*)').exec(window.location.href);
		return $.isArray(results) ? results[1] : undefined;
	};
	
	//	Standard write
	document.write = writeInterrupt;
	
	//	Standard write
	document.writeln = writeInterrupt;
	
	//	Start of Load Time 
	_.loadTime.start = LOAD_START;
	
	$(function ()
	{
		$('<style type="text/css">' + CSS_RULES.join('') + '</style>').appendTo("head");
	
		//	End of Load Time
		_.loadTime.end = new Date();
		
		$('a.deferred-script-load').each(function ()
		{
			$.getScript($(this).attr('href'));
		});
	});
	
}(jQuery));

